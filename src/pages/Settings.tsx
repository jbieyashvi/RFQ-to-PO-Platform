import { useState } from 'react';
import { Save, Lock, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { Button, SectionCard, SelectField, TextField, Toggle, Tabs } from '@/components/ui';
import { useAuth, DEMO_PASSWORD, type NotificationPrefs } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';

const LANGUAGES = ['English (India)', 'English (US)', 'Hindi (हिन्दी)'];
const TIMEZONES = ['Asia/Kolkata (IST, GMT+5:30)', 'Asia/Dubai (GST, GMT+4)', 'Europe/London (GMT)', 'America/New_York (EST)'];
const DATE_FORMATS = ['DD MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const CURRENCY_FORMATS = ['INR (₹) — Indian numbering', 'USD ($)', 'EUR (€)'];

const NOTIF_ITEMS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'email', label: 'Email notifications', hint: 'Master switch for all email updates.' },
  { key: 'quoteReviewReminders', label: 'Quote review reminders', hint: 'Reminders when a quotation review date is approaching.' },
  { key: 'pendingQuotationAlerts', label: 'Pending quotation alerts', hint: 'Alerts for quotations still pending to be sent.' },
  { key: 'revisionRequests', label: 'Revision requests', hint: 'When a customer or reviewer requests a revision.' },
  { key: 'poMismatchAlerts', label: 'PO mismatch alerts', hint: 'When a customer PO does not match the accepted quotation.' },
  { key: 'inboxAssignment', label: 'Inbox assignment notifications', hint: 'When a Global Inbox email is assigned to you.' },
];

export default function Settings() {
  const { settings, updateSettings, updateNotifications } = useAuth();
  const { addToast } = useApp();
  const [tab, setTab] = useState('general');

  // General (local until Save)
  const [general, setGeneral] = useState({
    language: settings.language,
    timezone: settings.timezone,
    dateFormat: settings.dateFormat,
    currencyFormat: settings.currencyFormat,
  });
  const generalDirty =
    general.language !== settings.language ||
    general.timezone !== settings.timezone ||
    general.dateFormat !== settings.dateFormat ||
    general.currencyFormat !== settings.currencyFormat;

  const saveGeneral = () => {
    updateSettings(general);
    addToast({ type: 'success', title: 'Preferences saved', message: 'Your general preferences have been updated.' });
  };

  // Security
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});

  const changePassword = () => {
    const e: Record<string, string> = {};
    if (!current) e.current = 'Enter your current password';
    else if (current !== DEMO_PASSWORD) e.current = 'Current password is incorrect';
    if (!next) e.next = 'Enter a new password';
    else if (next.length < 8) e.next = 'Password must be at least 8 characters';
    else if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) e.next = 'Use at least one letter and one number';
    else if (next === current) e.next = 'New password must differ from the current one';
    if (confirm !== next) e.confirm = 'Passwords do not match';
    setPwErrors(e);
    if (Object.keys(e).length) return;
    setCurrent(''); setNext(''); setConfirm('');
    addToast({ type: 'success', title: 'Password updated', message: 'Your password has been changed (prototype).' });
  };

  return (
    <>
      <PageHeader
        title="Account Settings"
        description="Manage your preferences, notifications and security. Role and office permissions are managed by your administrator."
        crumbs={[{ label: 'Account Settings' }]}
      />

      <div className="card overflow-hidden">
        <div className="px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'general', label: 'General' },
              { key: 'notifications', label: 'Notifications' },
              { key: 'security', label: 'Security' },
            ]}
          />
        </div>

        <div className="p-5">
          {tab === 'general' && (
            <div className="max-w-2xl space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SelectField label="Language" value={general.language} onChange={(e) => setGeneral((g) => ({ ...g, language: e.target.value }))} options={LANGUAGES.map((v) => ({ value: v, label: v }))} />
                <SelectField label="Time zone" value={general.timezone} onChange={(e) => setGeneral((g) => ({ ...g, timezone: e.target.value }))} options={TIMEZONES.map((v) => ({ value: v, label: v }))} />
                <SelectField label="Date format" value={general.dateFormat} onChange={(e) => setGeneral((g) => ({ ...g, dateFormat: e.target.value }))} options={DATE_FORMATS.map((v) => ({ value: v, label: v }))} />
                <SelectField label="Currency format" value={general.currencyFormat} onChange={(e) => setGeneral((g) => ({ ...g, currencyFormat: e.target.value }))} options={CURRENCY_FORMATS.map((v) => ({ value: v, label: v }))} />
              </div>
              <div className="flex justify-end pt-1">
                <Button variant="primary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={saveGeneral} disabled={!generalDirty}>Save Changes</Button>
              </div>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="max-w-2xl divide-y divide-surface-100">
              {NOTIF_ITEMS.map((n) => (
                <div key={n.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-surface-800">{n.label}</p>
                    <p className="text-xs text-surface-400">{n.hint}</p>
                  </div>
                  <Toggle
                    checked={settings.notifications[n.key]}
                    onChange={(v) => updateNotifications({ [n.key]: v } as Partial<NotificationPrefs>)}
                  />
                </div>
              ))}
            </div>
          )}

          {tab === 'security' && (
            <SectionCard
              title={<span className="flex items-center gap-2"><Lock className="h-4 w-4 text-brand-500" /> Change Password</span>}
              className="max-w-lg border-surface-200"
            >
              <div className="space-y-4">
                <TextField label="Current password" type="password" autoComplete="current-password" value={current} error={pwErrors.current} onChange={(e) => setCurrent(e.target.value)} />
                <TextField label="New password" type="password" autoComplete="new-password" value={next} error={pwErrors.next} hint="At least 8 characters with a letter and a number." onChange={(e) => setNext(e.target.value)} />
                <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} error={pwErrors.confirm} onChange={(e) => setConfirm(e.target.value)} />
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs text-surface-400"><ShieldCheck className="h-3.5 w-3.5" /> Demo current password: {DEMO_PASSWORD}</p>
                  <Button variant="primary" size="sm" onClick={changePassword}>Update Password</Button>
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </>
  );
}
