'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { clearCurrentTenantId, setCurrentLocale, setCurrentUserId } from '../../lib/user';

type FamilyRole = 'parent' | 'child';

type CreatedInvite = {
  id: string;
  email: string;
  role: FamilyRole;
  token: string;
};

export default function RegisterPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [familyName, setFamilyName] = useState('');
  const [signupRole, setSignupRole] = useState<FamilyRole>('parent');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<FamilyRole>('parent');
  const [createdInvites, setCreatedInvites] = useState<CreatedInvite[]>([]);

  const [step, setStep] = useState<'register' | 'invite'>('register');
  const [loading, setLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [error, setError] = useState('');

  const displayName = useMemo(() => `${firstName} ${lastName}`.trim(), [firstName, lastName]);
  const appBaseUrl = typeof window === 'undefined' ? '' : window.location.origin;

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!displayName || !email.trim() || !password.trim() || !familyName.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const data = await api.post('/family/create', {
        familyName,
        displayName,
        role: signupRole,
        email,
        password,
      });
      if (data?.admin?.id) {
        setCurrentUserId(data.admin.id);
        setCurrentLocale(data.admin.locale || 'en');
        clearCurrentTenantId();
      }
      setStep('invite');
    } catch (err: any) {
      setError(err.message || 'Failed to register');
    } finally {
      setLoading(false);
    }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!inviteEmail.trim()) {
      setError('Please enter an email address.');
      return;
    }

    setInviteLoading(true);
    try {
      const invite = await api.post('/family/invites', { email: inviteEmail, role: inviteRole });
      setCreatedInvites((prev) => [
        ...prev,
        {
          id: invite.id,
          email: invite.email,
          role: invite.role as FamilyRole,
          token: invite.token,
        },
      ]);
      setInviteEmail('');
      setInviteRole('parent');
    } catch (err: any) {
      setError(err.message || 'Failed to send invite');
    } finally {
      setInviteLoading(false);
    }
  }

  function finishSetup() {
    router.push('/chorespace');
  }

  if (step === 'invite') {
    return (
      <section className="auth-shell">
        <div className="card auth-card">
          <div className="page-title">
            <h2>Invite Family Members</h2>
            <p className="lead">Send registration links by email and set their role. You can skip this and do it later.</p>
          </div>

          {error && <p className="error">{error}</p>}

          <form className="invite-form" onSubmit={onInvite}>
            <label>
              Family member email
              <input
                type="email"
                placeholder="family@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </label>

            <label>
              Role
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as FamilyRole)}>
                <option value="parent">Parent</option>
                <option value="child">Child</option>
              </select>
            </label>

            <button type="submit" disabled={inviteLoading}>
              {inviteLoading ? 'Sending…' : 'Send Registration Link'}
            </button>
          </form>

          {createdInvites.length > 0 && (
            <div className="card invite-list">
              <h3>Invites Sent</h3>
              <ul className="list compact">
                {createdInvites.map((invite) => (
                  <li key={invite.id}>
                    <strong>{invite.email}</strong> as {invite.role}
                    {appBaseUrl && (
                      <p className="task-meta">
                        Link:{' '}
                        <a href={`${appBaseUrl}/family/accept?token=${invite.token}`}>
                          {appBaseUrl}/family/accept?token={invite.token}
                        </a>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="auth-secondary">
            Roles are collected now for onboarding flow and can be finalized after each member accepts their invite.
          </p>

          <div className="action-row">
            <button type="button" onClick={finishSetup}>
              Continue to Chorespace
            </button>
            <button type="button" className="ghost-button" onClick={finishSetup}>
              Skip for Now
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-shell">
      <form className="card auth-card" onSubmit={onRegister}>
        <div className="page-title">
          <h2>Register</h2>
          <p className="lead">Create your account and the family you will be part of.</p>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="form-grid auth-grid">
          <label>
            First Name
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </label>

          <label>
            Last Name
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </label>
        </div>

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>
          Password
          <div className="password-row">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <button type="button" className="ghost-button" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label>
          Confirm Password
          <div className="password-row">
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
            <button type="button" className="ghost-button" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label>
          Role
          <select value={signupRole} onChange={(e) => setSignupRole(e.target.value as FamilyRole)}>
            <option value="parent">Parent</option>
            <option value="child">Child</option>
          </select>
        </label>

        <label>
          Family Name
          <input
            placeholder="The Levy Family"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            required
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? 'Creating Family…' : 'Create Account'}
        </button>

        <p className="auth-secondary">
          Already have an account? <Link href="/">Back to login</Link>
        </p>
      </form>
    </section>
  );
}
