import { useEffect, useState } from 'react';
import { Camera, Save, X } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { Button, TextField, SectionCard } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { ROLE_LABELS } from '@/lib/labels';

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export default function Profile() {
  const { profile, updateProfile } = useAuth();
  const { addToast } = useApp();

  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone);
  const [jobTitle, setJobTitle] = useState(profile.jobTitle);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setFullName(profile.fullName);
    setPhone(profile.phone);
    setJobTitle(profile.jobTitle);
  }, [profile]);

  const dirty = fullName !== profile.fullName || phone !== profile.phone || jobTitle !== profile.jobTitle;

  const reset = () => {
    setFullName(profile.fullName);
    setPhone(profile.phone);
    setJobTitle(profile.jobTitle);
    setErrors({});
  };

  const save = () => {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.fullName = 'Full name is required';
    if (!/^[+\d][\d\s-]{7,}$/.test(phone)) e.phone = 'Enter a valid phone number';
    setErrors(e);
    if (Object.keys(e).length) return;
    updateProfile({ fullName: fullName.trim(), phone: phone.trim(), jobTitle: jobTitle.trim() });
    addToast({ type: 'success', title: 'Profile updated', message: 'Your profile changes have been saved.' });
  };

  return (
    <>
      <PageHeader
        title="My Profile"
        description="Your personal details and contact information."
        crumbs={[{ label: 'My Profile' }]}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Avatar card */}
        <SectionCard title="Profile Photo">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-white">
              {initials(profile.fullName)}
            </span>
            <p className="mt-3 text-sm font-semibold text-surface-800">{profile.fullName}</p>
            <p className="text-xs text-surface-400">{ROLE_LABELS[profile.role]}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              leftIcon={<Camera className="h-4 w-4" />}
              onClick={() => addToast({ type: 'info', title: 'Change photo', message: 'Photo upload is a prototype action in this demo.' })}
            >
              Change Photo
            </Button>
          </div>
        </SectionCard>

        {/* Details */}
        <SectionCard
          title="Personal Details"
          className="lg:col-span-2"
          action={
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" leftIcon={<X className="h-4 w-4" />} onClick={reset} disabled={!dirty}>Cancel</Button>
              <Button variant="primary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={save} disabled={!dirty}>Save Changes</Button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Full Name" required value={fullName} error={errors.fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            <TextField label="Work Email" value={profile.email} disabled hint="Managed by your administrator" onChange={() => {}} />
            <TextField label="Phone Number" required value={phone} error={errors.phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            <TextField label="Job Title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Head of Inside Sales" />
            <TextField label="Employee ID" value={profile.employeeId} disabled onChange={() => {}} />
            <TextField label="Assigned Sales Office" value={officeName(profile.officeId)} disabled hint="Set by the Sales Office Master" onChange={() => {}} />
            <TextField label="Current Role" value={ROLE_LABELS[profile.role]} disabled hint="Controlled by the admin permission system" onChange={() => {}} />
          </div>
        </SectionCard>
      </div>
    </>
  );
}
