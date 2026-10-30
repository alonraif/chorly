import type { Locale } from './types';

// Push/email text, rendered in each recipient's own language.

type ChoreNames = { title_en: string; title_he: string };

export function choreName(chore: ChoreNames, locale: Locale) {
  return (locale === 'he' ? chore.title_he || chore.title_en : chore.title_en || chore.title_he) || '';
}

export const notificationText = {
  readyForApproval: (locale: Locale, kid: string, chore: string) =>
    locale === 'he'
      ? { title: `✅ ${kid}`, body: `${chore} — מחכה לאישור` }
      : { title: `✅ ${kid}`, body: `${chore} — ready for approval` },

  approved: (locale: Locale, chore: string, reward: string | null) =>
    locale === 'he'
      ? { title: '⭐ אושר!', body: reward ? `${chore} (+${reward})` : chore }
      : { title: '⭐ Approved!', body: reward ? `${chore} (+${reward})` : chore },

  rejected: (locale: Locale, chore: string, reason: string | null) =>
    locale === 'he'
      ? { title: '↩️ המטלה עוד לא הושלמה', body: reason ? `${chore}: ${reason}` : chore }
      : { title: '↩️ Chore not complete yet', body: reason ? `${chore}: ${reason}` : chore },

  test: (locale: Locale, name: string) =>
    locale === 'he'
      ? { title: 'Chorly', body: `ההתראות עובדות, ${name}!` }
      : { title: 'Chorly', body: `Notifications work, ${name}!` },

  morning: (locale: Locale, name: string, count: number, chores: string[]) =>
    locale === 'he'
      ? { title: `☀️ ${name}: ${count === 1 ? 'מטלה אחת' : `${count} מטלות`} להיום`, body: chores.join(' · ') }
      : { title: `☀️ ${name}: ${count} ${count === 1 ? 'chore' : 'chores'} today`, body: chores.join(' · ') },

  dueSoon: (locale: Locale, name: string, minutes: number, chores: string[]) =>
    locale === 'he'
      ? { title: `⏳ ${name}, בעוד ${minutes} דק׳`, body: chores.join(' · ') }
      : { title: `⏳ ${name}, due in ${minutes} min`, body: chores.join(' · ') },

  overdue: (locale: Locale, name: string, chores: string[]) =>
    locale === 'he'
      ? { title: `⏰ ${name}, עוד לא בוצע`, body: chores.join(' · ') }
      : { title: `⏰ ${name}, still to do`, body: chores.join(' · ') },

  // Lines are "kid – chore".
  parentOverdue: (locale: Locale, lines: string[]) =>
    locale === 'he'
      ? { title: '📋 עוד פתוח', body: lines.join(' · ') }
      : { title: '📋 Still open', body: lines.join(' · ') },

  // Parents get the whole family's week; `kids` lines are "name count".
  weeklyFamily: (locale: Locale, approved: number, earned: string, missed: number, kids: string[]) => {
    const tail = kids.length ? ` ${kids.join(' · ')}` : '';
    return locale === 'he'
      ? {
          title: '📊 השבוע של המשפחה',
          body: `${approved === 1 ? 'מטלה אחת אושרה' : `${approved} מטלות אושרו`}, ${earned} הורווחו, ${missed} לא בוצעו.${tail}`,
        }
      : {
          title: '📊 Family week',
          body: `${approved} ${approved === 1 ? 'chore' : 'chores'} approved, ${earned} earned, ${missed} missed.${tail}`,
        };
  },

  weekly: (locale: Locale, name: string, approved: number, earned: string, upcoming: number) =>
    locale === 'he'
      ? {
          title: `📊 ${name}: השבוע שלך`,
          body: `${approved} מטלות אושרו, הרווחת ${earned}. ${upcoming} מתוכננות לשבוע הקרוב.`,
        }
      : {
          title: `📊 ${name}: your week`,
          body: `${approved} ${approved === 1 ? 'chore' : 'chores'} approved, earned ${earned}. ${upcoming} coming up this week.`,
        },
  placeArrived: (locale: Locale, name: string, place: string) =>
    locale === 'he' ? { title: `📍 ${name}`, body: `הגיע/ה ל${place}` } : { title: `📍 ${name}`, body: `Arrived at ${place}` },

  placeLeft: (locale: Locale, name: string, place: string) =>
    locale === 'he' ? { title: `🚶 ${name}`, body: `יצא/ה מ${place}` } : { title: `🚶 ${name}`, body: `Left ${place}` },

  // Sent to the person who just got home, with what is still open today.
  welcomeHome: (locale: Locale, name: string, chores: string[]) =>
    locale === 'he'
      ? { title: `🏠 ${name}, ברוכים השבים`, body: `${chores.length === 1 ? 'מטלה אחת' : `${chores.length} מטלות`} להיום: ${chores.join(' · ')}` }
      : { title: `🏠 Welcome home, ${name}`, body: `${chores.length} ${chores.length === 1 ? 'chore' : 'chores'} today: ${chores.join(' · ')}` },

  placeReward: (locale: Locale, place: string, amount: string) =>
    locale === 'he'
      ? { title: '⭐ הגעת!', body: `${place} (+${amount})` }
      : { title: '⭐ You made it!', body: `${place} (+${amount})` },

  lowBattery: (locale: Locale, name: string, percent: number) =>
    locale === 'he'
      ? { title: `🪫 ${name}`, body: `הסוללה ב-${percent}%` }
      : { title: `🪫 ${name}`, body: `Battery at ${percent}%` },

  wentQuiet: (locale: Locale, name: string, minutes: number) =>
    locale === 'he'
      ? { title: `📵 ${name}`, body: `המיקום לא התעדכן ${minutes} דק׳` }
      : { title: `📵 ${name}`, body: `No location update for ${minutes} min` },

  tripStarted: (locale: Locale, name: string, place: string, minutes: number) =>
    locale === 'he'
      ? { title: `🧭 ${name}`, body: `בדרך ל${place}, בערך ${minutes} דק׳` }
      : { title: `🧭 ${name}`, body: `Heading to ${place}, about ${minutes} min` },

  errandClosest: (locale: Locale, errand: string) =>
    locale === 'he'
      ? { title: '🛒 את/ה הכי קרוב/ה', body: `${errand} — לחצו כדי לקחת` }
      : { title: '🛒 You’re the closest', body: `${errand} — tap to claim it` },

  errandNearby: (locale: Locale, errand: string) =>
    locale === 'he' ? { title: '📍 ממש לידך', body: errand } : { title: '📍 Right nearby', body: errand },

  poke: (locale: Locale, name: string, kind: 'wave' | 'comeHome' | 'dinner' | 'onMyWay' | 'thinking') => {
    const he = {
      wave: `${name} מנופף/ת לך 👋`,
      comeHome: `${name} מבקש/ת שתחזרו הביתה 🏠`,
      dinner: `${name}: ארוחת ערב מוכנה 🍽️`,
      onMyWay: `${name} בדרך אליך 🚗`,
      thinking: `${name} חושב/ת עליך 💛`,
    };
    const en = {
      wave: `${name} waved at you 👋`,
      comeHome: `${name} asks you to come home 🏠`,
      dinner: `${name}: dinner’s ready 🍽️`,
      onMyWay: `${name} is on the way 🚗`,
      thinking: `${name} is thinking of you 💛`,
    };
    return { title: 'Chorly', body: (locale === 'he' ? he : en)[kind] };
  },

  // Lines are "name – place hours".
  placeRecap: (locale: Locale, lines: string[]) =>
    locale === 'he' ? { title: '🗺️ השבוע במפה', body: lines.join(' · ') } : { title: '🗺️ The week on the map', body: lines.join(' · ') },
};
