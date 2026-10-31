'use client';

import { SHOPPING_CATEGORIES, shoppingKey, splitShoppingText, type ShoppingCategory } from '@chorly/shared';
import { FormEvent, useRef, useState, type ClipboardEvent } from 'react';
import { Avatar } from '../../components/avatar';
import { Icon } from '../../components/icon';
import { EmptyState, errorMessage, Sheet, Spinner, Switch, useUi } from '../../components/ui';
import { api } from '../../lib/api';
import { firstName, timeOf } from '../../lib/format';
import { joinNames, t, tn, type MessageKey } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { useShoppingList, type ShoppingItem } from '../../lib/shopping';

const CATEGORY_EMOJI: Record<ShoppingCategory, string> = {
  produce: '🥕',
  dairy: '🥛',
  meat: '🍗',
  bakery: '🥖',
  pantry: '🥫',
  frozen: '🧊',
  drinks: '🧃',
  snacks: '🍫',
  household: '🧽',
  personal: '🧴',
  baby: '🍼',
  pets: '🐾',
  other: '🛒',
};
const MAX_MATCHES = 6;

const categoryName = (category: ShoppingCategory) => t(`shopping.category.${category}` as MessageKey);

export default function ShoppingPage() {
  const { me, members } = useSession();
  const { toast } = useUi();
  const list = useShoppingList(me.id, (err) => toast(errorMessage(err, t('common.somethingWrong')), 'error'));
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [trip, setTrip] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const needed = list.items.filter((item) => item.state === 'needed');
  const bought = list.items
    .filter((item) => item.state === 'bought')
    .sort((a, b) => (b.boughtAt ?? '').localeCompare(a.boughtAt ?? ''));
  const urgent = needed.filter((item) => item.urgent);
  const onList = new Set(list.items.map((item) => shoppingKey(item.name)));
  const person = (id: string | null) => members.find((m) => m.id === id);
  const shoppers = list.shopperIds.flatMap((id) => person(id) ?? []);
  const imShopping = list.shopperIds.includes(me.id);

  const typed = shoppingKey(draft);
  const matches = typed
    ? list.known
        .filter(({ name }) => {
          const key = shoppingKey(name);
          return key !== typed && key.includes(typed) && !onList.has(key);
        })
        .sort((a, b) => Number(shoppingKey(b.name).startsWith(typed)) - Number(shoppingKey(a.name).startsWith(typed)))
        .slice(0, MAX_MATCHES)
    : [];

  function add(text: string) {
    const already = list.add(text);
    if (already.length > 0) toast(t('shopping.alreadyOnList', { names: joinNames(already) }), 'info');
    setDraft('');
    input.current?.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (splitShoppingText(draft).length > 0) add(draft);
  }

  // A one-line box would run a pasted list together into a single item.
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return;
    e.preventDefault();
    setDraft(splitShoppingText(text).join(', '));
  }

  async function toggleTrip() {
    setTrip(true);
    try {
      if (imShopping) await api.delete('/shopping/trip');
      else await api.post('/shopping/trip');
      await list.reload();
    } catch (err) {
      toast(errorMessage(err, t('shopping.couldNotTellFamily')), 'error');
    } finally {
      setTrip(false);
    }
  }

  const row = (item: ShoppingItem) => {
    const isBought = item.state === 'bought';
    const who = person(isBought ? item.boughtById : item.addedById);
    const sub = isBought
      ? [who && firstName(who.displayName), item.boughtAt && timeOf(item.boughtAt)].filter(Boolean).join(' · ')
      : item.note;
    return (
      <li key={item.id} className={`shop-row ${isBought ? 'is-bought' : ''}`}>
        <button
          type="button"
          className="shop-check"
          role="checkbox"
          aria-checked={isBought}
          aria-label={item.name}
          onClick={() => (isBought ? list.unbuy(item.id) : list.buy(item.id))}
        >
          {isBought && <Icon name="check" size={18} />}
        </button>
        <button type="button" className="shop-main" onClick={() => setEditing(item)}>
          <span className="row-title">
            <bdi>{item.name}</bdi>
            {item.quantity && <span className="shop-quantity"> · <bdi>{item.quantity}</bdi></span>}
          </span>
          {sub && <span className="row-sub"><bdi>{sub}</bdi></span>}
        </button>
        {item.urgent && !isBought && (
          <span className="shop-urgent" title={t('shopping.urgent')}>
            <Icon name="flag" size={18} />
          </span>
        )}
        {who && <Avatar user={who} size={26} />}
      </li>
    );
  };

  const group = (title: string, items: ShoppingItem[]) => (
    <section className="section" key={title}>
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      <ul className="list-card rows">{items.map(row)}</ul>
    </section>
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>{t('shopping.title')}</h1>
          <p className="muted">{needed.length > 0 ? tn('shopping.toBuy', needed.length) : t('shopping.nothingToBuy')}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={toggleTrip} disabled={trip}>
          <Icon name={imShopping ? 'check' : 'cart'} size={18} /> {t(imShopping ? 'shopping.doneShopping' : 'shopping.goingShopping')}
        </button>
      </header>

      {shoppers.length > 0 && (
        <p className="shop-banner">
          <Icon name="cart" size={18} />
          <span>{t('shopping.outShopping', { names: joinNames(shoppers.map((s) => firstName(s.displayName))) })}</span>
        </p>
      )}
      {list.offline && (
        <p className="shop-banner shop-banner-offline">
          <Icon name="alert" size={18} />
          <span>{list.waiting > 0 ? tn('shopping.waiting', list.waiting) : t('shopping.offline')}</span>
        </p>
      )}

      <form className="shop-add" onSubmit={submit}>
        <input
          ref={input}
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={paste}
          placeholder={t('shopping.addPlaceholder')}
          aria-label={t('shopping.addPlaceholder')}
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="submit" className="btn btn-primary" disabled={!typed}>
          <Icon name="plus" size={18} /> {t('common.add')}
        </button>
      </form>
      {matches.length > 0 && (
        <div className="chip-row shop-matches">
          {matches.map(({ name }) => (
            // Keeps the keyboard up: focus stays in the box.
            <button key={name} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => add(name)}>
              <bdi>{name}</bdi>
            </button>
          ))}
        </div>
      )}

      {!list.loaded && list.offline ? (
        <EmptyState icon="alert" title={t('shopping.couldNotLoad')} />
      ) : !list.loaded ? (
        <div className="shop-loading"><Spinner /></div>
      ) : (
        <>
          {needed.length === 0 && bought.length === 0 && (
            <EmptyState icon="cart" title={t('shopping.emptyTitle')}>{t('shopping.emptyHint')}</EmptyState>
          )}
          {urgent.length > 0 && group(t('shopping.urgent'), urgent)}
          {SHOPPING_CATEGORIES.map((category) => {
            const items = needed
              .filter((item) => !item.urgent && item.category === category)
              .sort((a, b) => a.name.localeCompare(b.name));
            return items.length > 0 ? group(`${CATEGORY_EMOJI[category]} ${categoryName(category)}`, items) : null;
          })}
          {list.buyAgain.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{t('shopping.buyAgain')}</h2>
              </div>
              <div className="chip-row">
                {list.buyAgain
                  .filter((name) => !onList.has(shoppingKey(name)))
                  .map((name) => (
                    <button key={name} type="button" className="chip" onClick={() => list.add(name)}>
                      <Icon name="plus" size={16} /> <bdi>{name}</bdi>
                    </button>
                  ))}
              </div>
            </section>
          )}
          {bought.length > 0 && group(t('shopping.bought'), bought)}
        </>
      )}

      {editing && (
        <ItemSheet
          key={editing.id}
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            list.update(editing.id, patch);
            setEditing(null);
          }}
          onRemove={() => {
            list.remove(editing.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ItemSheet({
  item,
  onClose,
  onSave,
  onRemove,
}: {
  item: ShoppingItem;
  onClose: () => void;
  onSave: (patch: { name: string; quantity: string | null; note: string | null; category: ShoppingCategory; urgent: boolean }) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [category, setCategory] = useState(item.category);
  const [urgent, setUrgent] = useState(item.urgent);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), quantity: quantity.trim() || null, note: note.trim() || null, category, urgent });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={item.name}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost-danger" onClick={onRemove}>
            {t(item.state === 'bought' ? 'shopping.forget' : 'shopping.remove')}
          </button>
          <button type="submit" form="shopping-item" className="btn btn-primary">
            {t('common.save')}
          </button>
        </>
      }
    >
      <form id="shopping-item" className="stack" onSubmit={submit}>
        <label className="field">
          <span className="field-label">{t('shopping.name')}</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">{t('shopping.quantity')}</span>
          <input className="input" value={quantity} maxLength={30} onChange={(e) => setQuantity(e.target.value)} placeholder={t('shopping.quantityExample')} />
        </label>
        <label className="field">
          <span className="field-label">{t('shopping.note')}</span>
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t('shopping.noteExample')} />
        </label>
        <label className="field">
          <span className="field-label">{t('shopping.aisle')}</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ShoppingCategory)}>
            {SHOPPING_CATEGORIES.map((option) => (
              <option key={option} value={option}>{`${CATEGORY_EMOJI[option]} ${categoryName(option)}`}</option>
            ))}
          </select>
        </label>
        {item.state === 'needed' && <Switch checked={urgent} onChange={setUrgent} label={t('shopping.urgent')} hint={t('shopping.urgentHint')} />}
      </form>
    </Sheet>
  );
}
