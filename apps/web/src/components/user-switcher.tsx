'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import {
  clearCurrentTenantId,
  clearCurrentUserId,
  getCurrentTenantId,
  getCurrentUserId,
  setCurrentTenantId,
  setCurrentUserId,
} from '../lib/user';

type User = {
  id: string;
  displayName: string;
  email: string | null;
  isAdmin: boolean;
  isSystemAdmin?: boolean;
};

export function UserSwitcher() {
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState('');
  const [manualUserId, setManualUserId] = useState('');
  const [tenantOverride, setTenantOverride] = useState('');
  const [error, setError] = useState('');

  const currentUser = getCurrentUserId();
  const currentTenant = getCurrentTenantId();

  const selectedUser = useMemo(() => users.find((u) => u.id === selected), [users, selected]);

  useEffect(() => {
    setManualUserId(currentUser || '');
    setTenantOverride(currentTenant || '');
    if (!currentUser) return;

    api.get('/users')
      .then((list: User[]) => {
        setUsers(list);
        const next = list.some((u) => u.id === currentUser) ? currentUser : '';
        setSelected(next);
      })
      .catch(() => {
        setUsers([]);
      });
  }, []);

  function applySession() {
    setError('');
    if (!manualUserId.trim()) {
      setError('User ID required');
      return;
    }
    setCurrentUserId(manualUserId.trim());
    if (tenantOverride.trim()) {
      setCurrentTenantId(tenantOverride.trim());
    } else {
      clearCurrentTenantId();
    }
    window.location.reload();
  }

  return (
    <div className="switcher switcher-wrap">
      <label htmlFor="user-switch">User:</label>
      <select
        id="user-switch"
        value={selected}
        onChange={(e) => {
          const id = e.target.value;
          setSelected(id);
          setManualUserId(id);
          if (id) {
            setCurrentUserId(id);
            window.location.reload();
          }
        }}
      >
        <option value="">Select from current family</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.displayName} {user.isSystemAdmin ? '(root)' : user.isAdmin ? '(admin)' : ''}
          </option>
        ))}
      </select>

      <input
        placeholder="User ID"
        value={manualUserId}
        onChange={(e) => setManualUserId(e.target.value)}
      />

      <input
        placeholder="Tenant override (root only)"
        value={tenantOverride}
        onChange={(e) => setTenantOverride(e.target.value)}
      />

      <button type="button" onClick={applySession}>Apply</button>
      <button
        type="button"
        onClick={() => {
          clearCurrentUserId();
          clearCurrentTenantId();
          window.location.reload();
        }}
      >
        Clear
      </button>

      {selectedUser?.isSystemAdmin && <small>System admin detected. You can set tenant override.</small>}
      {error && <small className="error">{error}</small>}
    </div>
  );
}
