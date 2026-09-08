import { useEffect, useRef, useState } from 'react';

import { authClient } from '../../lib/auth-client';
import UiSelect from './UiSelect';

type Language = 'en' | 'th';
type CheckState = 'ready' | 'pending' | 'unavailable' | 'deferred';
type FieldName = 'siteName' | 'tagline' | 'siteDescription' | 'defaultLocale' | 'timezone' | 'adminPath' | 'email';

interface InstallerWizardProps {
  language: Language;
}

interface InstallForm {
  siteName: string;
  tagline: string;
  siteDescription: string;
  defaultLocale: Language;
  timezone: 'Asia/Bangkok' | 'UTC';
  adminPath: string;
  email: string;
  installationToken: string;
}

interface ReadinessResponse {
  installed: boolean;
  ready: boolean;
  checks: {
    database: CheckState;
    migrations: CheckState;
    storage: CheckState;
    relyingParty: CheckState;
  };
  rp: { id: string; name: string; origin: string };
  redirectTo?: string;
}

interface EnrollmentResponse {
  context: string;
  expiresAt: string;
  rp: { id: string; name: string };
}

const reservedAdminPaths = new Set(['/api', '/install', '/health', '/_astro', '/blog', '/th', '/en']);
const adminPathPattern = /^\/[a-z0-9][a-z0-9-]{1,39}$/;
const fieldControlIds: Record<FieldName, string> = {
  siteName: 'site-name',
  tagline: 'tagline',
  siteDescription: 'site-description',
  defaultLocale: 'default-locale',
  timezone: 'timezone',
  adminPath: 'admin-path',
  email: 'owner-email',
};

const copies = {
  en: {
    steps: ['System readiness', 'Site details', 'Owner identity', 'Installation token', 'Primary Passkey', 'Recovery codes'],
    contexts: [
      ['Let’s check the essentials', 'TomeCMS checks PostgreSQL, migrations, storage planning, and the Passkey identity before you begin.'],
      ['Tell readers about your site', 'Choose the public name, Tagline, language, timezone, and a private Admin address.'],
      ['Who will own this site?', 'This email identifies the first owner. Signing in uses a Passkey, not a password.'],
      ['Confirm this installation', 'Use the one-time token created by the local or VPS bootstrap script.'],
      ['Create your primary Passkey', 'Your device will ask for Touch ID, Windows Hello, a security key, or another Passkey provider.'],
      ['Save your recovery codes', 'These codes are shown once. Copy or download them before continuing.'],
    ],
    current: (step: number) => `Step ${step} of 6`,
    remaining: (step: number) => step === 6 ? 'Final step' : `${6 - step} steps left`,
    checking: 'Checking system readiness…',
    ready: 'Ready to continue',
    retry: 'Check again',
    back: 'Back',
    continue: 'Continue',
    errorFallback: 'Something did not finish. Follow the note below and try again.',
  },
  th: {
    steps: ['ตรวจสอบระบบ', 'ข้อมูลเว็บไซต์', 'ข้อมูลเจ้าของ', 'Installation token', 'Passkey หลัก', 'Recovery codes'],
    contexts: [
      ['มาเช็กส่วนสำคัญกันก่อน', 'TomeCMS จะตรวจ PostgreSQL, migrations, แผนการเชื่อม Storage และตัวตน Passkey ก่อนเริ่มตั้งค่า'],
      ['เล่าให้ผู้อ่านรู้จักเว็บไซต์', 'กำหนดชื่อ Tagline ภาษา เขตเวลา และ URL ส่วนตัวสำหรับเข้า Admin'],
      ['ใครเป็นเจ้าของเว็บไซต์นี้?', 'อีเมลนี้ใช้ระบุเจ้าของคนแรก ส่วนการเข้าสู่ระบบใช้ Passkey แทนรหัสผ่าน'],
      ['ยืนยันการติดตั้งเครื่องนี้', 'ใช้ token แบบครั้งเดียวที่สร้างจากสคริปต์เตรียมระบบบน Local หรือ VPS'],
      ['สร้าง Passkey หลัก', 'อุปกรณ์จะให้ยืนยันด้วย Touch ID, Windows Hello, security key หรือผู้ให้บริการ Passkey'],
      ['เก็บ Recovery codes ให้ปลอดภัย', 'รหัสชุดนี้แสดงเพียงครั้งเดียว กรุณาคัดลอกหรือดาวน์โหลดก่อนดำเนินการต่อ'],
    ],
    current: (step: number) => `ขั้นที่ ${step} จาก 6`,
    remaining: (step: number) => step === 6 ? 'ขั้นสุดท้าย' : `เหลืออีก ${6 - step} ขั้น`,
    checking: 'กำลังตรวจสอบระบบ…',
    ready: 'พร้อมดำเนินการต่อ',
    retry: 'ตรวจอีกครั้ง',
    back: 'ย้อนกลับ',
    continue: 'ดำเนินการต่อ',
    errorFallback: 'ขั้นตอนยังไม่สำเร็จ กรุณาทำตามคำแนะนำด้านล่างแล้วลองอีกครั้ง',
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCheckState(value: unknown): value is CheckState {
  return value === 'ready' || value === 'pending' || value === 'unavailable' || value === 'deferred';
}

function parseReadiness(value: unknown): ReadinessResponse | null {
  if (!isRecord(value) || typeof value.installed !== 'boolean' || typeof value.ready !== 'boolean'
    || !isRecord(value.checks) || !isRecord(value.rp)
    || !isCheckState(value.checks.database) || !isCheckState(value.checks.migrations)
    || !isCheckState(value.checks.storage) || !isCheckState(value.checks.relyingParty)
    || typeof value.rp.id !== 'string' || typeof value.rp.name !== 'string'
    || typeof value.rp.origin !== 'string' || !URL.canParse(value.rp.origin)
    || new URL(value.rp.origin).origin !== value.rp.origin
    || (value.redirectTo !== undefined && typeof value.redirectTo !== 'string')) return null;
  return value as unknown as ReadinessResponse;
}

function responseError(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string' ? value.error : fallback;
}

function apiError(response: Response, value: unknown, language: Language, fallback: string): string {
  if (language === 'en') return responseError(value, fallback);
  const messages: Partial<Record<number, string>> = {
    400: 'ข้อมูลหรือสิทธิ์ชั่วคราวไม่ถูกต้อง กรุณาตรวจข้อมูลแล้วลองใหม่',
    401: 'Token หรือ Passkey session ไม่ถูกต้อง กรุณายืนยันใหม่',
    403: 'คำขอนี้ไม่ได้มาจาก URL ที่ตั้งค่าไว้ กรุณาเปิด Installer จาก URL หลัก',
    409: 'มีการติดตั้งหรือเริ่มขั้นตอนนี้ไปแล้ว กรุณาตรวจสถานะอีกครั้ง',
    429: 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
    503: 'Database หรือ migrations ยังไม่พร้อม กรุณาแก้รายการที่แจ้งแล้วตรวจอีกครั้ง',
  };
  return messages[response.status] ?? fallback;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function InstallerWizard({ language }: InstallerWizardProps) {
  const copy = copies[language];
  const heading = useRef<HTMLHeadingElement>(null);
  const recoveryField = useRef<HTMLTextAreaElement>(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<InstallForm>({
    siteName: language === 'th' ? 'บันทึกของฉัน' : 'My notes',
    tagline: '',
    siteDescription: language === 'th' ? 'เรื่องงาน ซอฟต์แวร์ และสิ่งที่ได้เรียนรู้' : 'Notes on work, software, and what I learn.',
    defaultLocale: language,
    timezone: 'Asia/Bangkok',
    adminPath: '/admin',
    email: '',
    installationToken: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [originMismatch, setOriginMismatch] = useState(false);
  const [context, setContext] = useState<string | null>(null);
  const [rp, setRp] = useState<{ id: string; name: string } | null>(null);
  const [registrationStarted, setRegistrationStarted] = useState(false);
  const [passkeyRegistered, setPasskeyRegistered] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [redirectTo, setRedirectTo] = useState('/admin');
  const [acknowledged, setAcknowledged] = useState(false);
  const [alert, setAlert] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<{ label: string; value: number }>({ label: copy.checking, value: 8 });
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'selected'>('idle');

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    const controller = new AbortController();
    void loadReadiness(controller.signal);
    return () => controller.abort();
  }, []);

  function updateField<K extends keyof InstallForm>(name: K, value: InstallForm[K]) {
    setForm((current) => ({ ...current, [name]: value }));
    if (name in fieldErrors) setFieldErrors((current) => ({ ...current, [name]: undefined }));
  }

  function validate(targetStep: number): boolean {
    const errors: Partial<Record<FieldName, string>> = {};
    if (targetStep === 2) {
      if (!form.siteName.trim() || form.siteName.trim().length > 120) errors.siteName = language === 'th' ? 'กรอกชื่อเว็บไซต์ไม่เกิน 120 ตัวอักษร' : 'Enter a site name up to 120 characters.';
      if (form.tagline.trim().length > 120) errors.tagline = language === 'th' ? 'Tagline ต้องไม่เกิน 120 ตัวอักษร' : 'Keep the Tagline under 120 characters.';
      if (form.siteDescription.trim().length > 160) errors.siteDescription = language === 'th' ? 'คำอธิบายต้องไม่เกิน 160 ตัวอักษร' : 'Keep the description under 160 characters.';
      if (!adminPathPattern.test(form.adminPath) || reservedAdminPaths.has(form.adminPath)) errors.adminPath = language === 'th' ? 'ใช้ / ตามด้วยตัวพิมพ์เล็ก ตัวเลข หรือขีดกลาง รวม 2–40 ตัว และห้ามใช้ path ของระบบ' : 'Use / plus 2–40 lowercase letters, numbers, or hyphens, and avoid system paths.';
    }
    if (targetStep === 3 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = language === 'th' ? 'กรอกอีเมลให้ครบ เช่น name@example.com' : 'Enter a complete address, such as name@example.com.';
    }
    setFieldErrors(errors);
    const firstInvalid = (Object.keys(errors) as FieldName[])[0];
    if (firstInvalid) {
      setAlert(language === 'th' ? 'ตรวจช่องที่มีปัญหา แล้วลองอีกครั้ง' : 'Check the highlighted field, then try again.');
      window.requestAnimationFrame(() => document.getElementById(fieldControlIds[firstInvalid])?.focus());
      return false;
    }
    setAlert('');
    return true;
  }

  async function loadReadiness(signal?: AbortSignal) {
    setBusy(true);
    setAlert('');
    setActivity({ label: copy.checking, value: 20 });
    try {
      const response = await fetch('/api/install/status', { headers: { Accept: 'application/json' }, signal });
      const body = await responseJson(response);
      const parsed = parseReadiness(body);
      if (!response.ok || !parsed) {
        throw new Error(apiError(response, body, language, copy.errorFallback));
      }
      const matchesOrigin = parsed.rp.origin === window.location.origin;
      setOriginMismatch(!matchesOrigin);
      if (parsed.installed && matchesOrigin) {
        window.location.assign(parsed.redirectTo ?? '/admin');
        return;
      }
      const effective = matchesOrigin ? parsed : {
        ...parsed,
        ready: false,
        checks: { ...parsed.checks, relyingParty: 'unavailable' as const },
      };
      setReadiness(effective);
      setRp({ id: parsed.rp.id, name: parsed.rp.name });
      setActivity({ label: effective.ready ? copy.ready : copy.errorFallback, value: 100 });
      if (!effective.ready) setAlert(copy.errorFallback);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setReadiness(null);
      setActivity({ label: copy.errorFallback, value: 100 });
      setAlert(error instanceof Error ? error.message : copy.errorFallback);
    } finally {
      setBusy(false);
    }
  }

  function nextFormStep() {
    if (step === 1 && readiness?.ready) setStep(2);
    else if ((step === 2 || step === 3) && validate(step)) setStep(step + 1);
  }

  function back() {
    if (step <= 1 || step >= 6 || registrationStarted) return;
    if (step === 5) {
      setContext(null);
      setRp(readiness?.rp ? { id: readiness.rp.id, name: readiness.rp.name } : null);
    }
    setAlert('');
    setStep(step - 1);
  }

  function restartEnrollment() {
    setContext(null);
    setRegistrationStarted(false);
    setPasskeyRegistered(false);
    setAlert('');
    setForm((current) => ({ ...current, installationToken: '' }));
    setRp(readiness?.rp ? { id: readiness.rp.id, name: readiness.rp.name } : null);
    setActivity({ label: language === 'th' ? 'กรอก token ใหม่เพื่อเริ่ม Passkey อีกครั้ง' : 'Enter the token again to restart Passkey setup.', value: 0 });
    setStep(4);
  }

  async function enroll() {
    if (!form.installationToken) {
      setAlert(language === 'th' ? 'วาง Installation token ก่อนดำเนินการต่อ' : 'Paste the installation token before continuing.');
      return;
    }
    setBusy(true);
    setAlert('');
    setActivity({ label: language === 'th' ? 'กำลังตรวจ token และเตรียม Passkey…' : 'Verifying the token and preparing Passkey registration…', value: 45 });
    try {
      const response = await fetch('/api/install/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await responseJson(response);
      if (!response.ok || !isRecord(body) || typeof body.context !== 'string' || typeof body.expiresAt !== 'string' || !isRecord(body.rp) || typeof body.rp.id !== 'string' || typeof body.rp.name !== 'string') {
        throw new Error(apiError(response, body, language, copy.errorFallback));
      }
      const enrollment = body as unknown as EnrollmentResponse;
      setContext(enrollment.context);
      setRp(enrollment.rp);
      setForm((current) => ({ ...current, installationToken: '' }));
      setActivity({ label: language === 'th' ? 'Token ถูกต้อง พร้อมสร้าง Passkey' : 'Token verified. Ready to create the Passkey.', value: 100 });
      setStep(5);
    } catch (error) {
      setForm((current) => ({ ...current, installationToken: '' }));
      setActivity({ label: copy.errorFallback, value: 100 });
      setAlert(error instanceof Error ? error.message : copy.errorFallback);
    } finally {
      setBusy(false);
    }
  }

  async function registerAndFinalize() {
    if (!context) return;
    setRegistrationStarted(true);
    setBusy(true);
    setAlert('');
    let registered = passkeyRegistered;
    try {
      if (!registered) {
        if (!window.PublicKeyCredential) throw new Error(language === 'th' ? 'เบราว์เซอร์นี้ไม่รองรับ Passkey กรุณาใช้เบราว์เซอร์รุ่นล่าสุด' : 'This browser does not support Passkeys. Use a current browser.');
        setActivity({ label: language === 'th' ? 'รอการยืนยัน Passkey จากอุปกรณ์…' : 'Waiting for your device to verify the Passkey…', value: 35 });
        const registration = await authClient.passkey.addPasskey({
          context,
          name: 'Primary passkey',
          createSession: true,
        });
        if (registration.error || !registration.data) {
          throw new Error(language === 'th' ? 'ยังสร้าง Passkey ไม่สำเร็จ ยืนยันกับอุปกรณ์แล้วลองอีกครั้ง' : 'The Passkey was not created. Confirm the device prompt and try again.');
        }
        registered = true;
        setPasskeyRegistered(true);
      }

      setActivity({ label: language === 'th' ? 'Passkey พร้อมแล้ว กำลังบันทึกการติดตั้ง…' : 'Passkey verified. Finalizing installation…', value: 78 });
      const { installationToken: _installationToken, ...site } = form;
      const response = await fetch('/api/install/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...site, context }),
      });
      const body = await responseJson(response);
      if (!response.ok || !isRecord(body) || !Array.isArray(body.recoveryCodes) || !body.recoveryCodes.every((code) => typeof code === 'string') || typeof body.redirectTo !== 'string') {
        throw new Error(apiError(response, body, language, copy.errorFallback));
      }
      setRecoveryCodes(body.recoveryCodes);
      setRedirectTo(body.redirectTo);
      setActivity({ label: language === 'th' ? 'ติดตั้งเสร็จแล้ว เหลือเพียงเก็บ Recovery codes' : 'Installation complete. Save the recovery codes.', value: 100 });
      setStep(6);
    } catch (error) {
      setActivity({ label: copy.errorFallback, value: 100 });
      setAlert(error instanceof Error ? error.message : copy.errorFallback);
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    const text = recoveryCodes.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('copied');
    } catch {
      recoveryField.current?.focus();
      recoveryField.current?.select();
      setCopyStatus('selected');
    }
  }

  function downloadRecoveryCodes() {
    const url = URL.createObjectURL(new Blob([`${recoveryCodes.join('\n')}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tomecms-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  const checkRows = [
    ['database', language === 'th' ? 'PostgreSQL database' : 'PostgreSQL database'],
    ['migrations', 'Database migrations'],
    ['storage', language === 'th' ? 'S3-compatible storage' : 'S3-compatible storage'],
    ['relyingParty', language === 'th' ? 'HTTPS / Passkey identity' : 'HTTPS / Passkey identity'],
  ] as const;

  function checkHelp(key: typeof checkRows[number][0], state: CheckState): string | null {
    if (state === 'ready' || state === 'pending') return null;
    if (key === 'storage') return language === 'th' ? 'จะตรวจและเชื่อมต่อในขั้น File Manager' : 'Validated later with the File Manager storage work.';
    if (key === 'database') return language === 'th' ? 'เปิด PostgreSQL แล้วกด “ตรวจอีกครั้ง”' : 'Start PostgreSQL, then choose “Check again”.';
    if (key === 'migrations') return language === 'th' ? 'รัน npm run db:migrate แล้วตรวจอีกครั้ง' : 'Run npm run db:migrate, then check again.';
    if (originMismatch && readiness?.rp.origin) {
      return language === 'th'
        ? `เปิด Installer ที่ ${readiness.rp.origin} ให้ตรง หรือแก้ TOME_CMS_PUBLIC_URL เป็น ${window.location.origin} แล้วตรวจอีกครั้ง`
        : `Open ${readiness.rp.origin} exactly, or set TOME_CMS_PUBLIC_URL to ${window.location.origin}, then check again.`;
    }
    return language === 'th' ? 'ตรวจ TOME_CMS_PUBLIC_URL ให้ตรงกับ URL นี้ และใช้ HTTPS เมื่อไม่ใช่ Local' : 'Make TOME_CMS_PUBLIC_URL match this site; use HTTPS outside local development.';
  }

  return (
    <>
      <section className="installer-progress" aria-label={language === 'th' ? 'ความคืบหน้าการติดตั้ง' : 'Installation progress'}>
        <ol aria-label={language === 'th' ? 'ขั้นตอนการติดตั้ง' : 'Installation steps'}>
          {copy.steps.map((label, index) => {
            const number = index + 1;
            const state = number < step ? 'complete' : number === step ? 'active' : undefined;
            return (
              <li aria-current={number === step ? 'step' : undefined} data-state={state} key={label}>
                <span className="installer-progress-dot">{number < step ? '✓' : number}</span>
                <span className="installer-progress-label">{label}</span>
              </li>
            );
          })}
        </ol>
        <div className="installer-meter">
          <span>{copy.current(step)}</span>
          <progress aria-label={`${copy.current(step)} ${copy.remaining(step)}`} aria-valuenow={step} max="6" value={step} />
          <span>{copy.remaining(step)}</span>
        </div>
        <div className="installer-activity" role="status" aria-live="polite">
          <span>{activity.label}</span>
          <progress aria-label={activity.label} aria-valuenow={activity.value} max="100" value={activity.value} />
        </div>
      </section>

      <section className="installer-workspace" aria-label="TomeCMS setup wizard">
        <aside className="installer-context">
          <div className="installer-context-copy">
            <span className="installer-step-index">{String(step).padStart(2, '0')} / 06</span>
            <h2>{copy.contexts[step - 1][0]}</h2>
            <p>{copy.contexts[step - 1][1]}</p>
          </div>
          <p className="installer-note"><span className="installer-note-mark" aria-hidden="true">✓</span><span>{language === 'th' ? 'ข้อมูลลับไม่ถูกแสดงใน log หรือบันทึกลงเบราว์เซอร์' : 'Secrets are never shown in logs or saved by the browser.'}</span></p>
        </aside>

        <form className="installer-task" onSubmit={(event) => event.preventDefault()} noValidate>
          {alert && <p className="installer-alert" role="alert">{alert}</p>}

          <section className="installer-step" data-step-content>
            {step === 1 && <>
              <div className="installer-step-head">
                <h2 ref={heading} tabIndex={-1}>{language === 'th' ? 'ระบบพร้อมแค่ไหน?' : 'Is the system ready?'}</h2>
                <p>{language === 'th' ? 'Storage จะแสดงเป็น “ดำเนินการภายหลัง” และไม่ขวางการตั้งค่ารอบนี้' : 'Storage is intentionally marked “deferred” and does not block this setup.'}</p>
              </div>
              <ul className="installer-checks">
                {checkRows.map(([key, label]) => {
                  const state = readiness?.checks[key] ?? (busy ? 'pending' : 'unavailable');
                  const ready = state === 'ready';
                  const deferred = state === 'deferred';
                  const help = checkHelp(key, state);
                  return <li className="installer-check" data-state={ready ? 'ready' : deferred ? 'deferred' : state === 'pending' ? 'checking' : 'error'} key={key}>
                    <span className="installer-check-mark" aria-hidden="true">{ready ? '✓' : deferred ? '–' : state === 'pending' ? '·' : '×'}</span>
                    <span><strong>{label}</strong>{key === 'relyingParty' && readiness?.rp?.origin && <small>{readiness.rp.origin}</small>}{help && <small>{help}</small>}</span>
                    <span className="installer-check-value">{ready ? (language === 'th' ? 'พร้อม' : 'Ready') : deferred ? (language === 'th' ? 'ภายหลัง' : 'Deferred') : state === 'pending' ? (language === 'th' ? 'กำลังตรวจ' : 'Checking') : (language === 'th' ? 'ต้องแก้ไข' : 'Needs attention')}</span>
                  </li>;
                })}
              </ul>
              <div className="installer-actions">
                {!readiness?.ready && <button className="installer-button" disabled={busy} onClick={() => void loadReadiness()} type="button">{copy.retry}</button>}
                <button className="installer-button installer-button--primary" disabled={!readiness?.ready || busy} onClick={nextFormStep} type="button">{language === 'th' ? 'ตั้งชื่อเว็บไซต์' : 'Name your site'} <span aria-hidden="true">→</span></button>
              </div>
            </>}

            {step === 2 && <>
              <div className="installer-step-head"><h2 ref={heading} tabIndex={-1}>{language === 'th' ? 'ข้อมูลเว็บไซต์' : 'Site details'}</h2><p>{language === 'th' ? 'ข้อมูลหน้าแรกและ SEO แก้ไขภายหลังได้' : 'Homepage and SEO details can be changed later.'}</p></div>
              <div className="installer-fields">
                <InstallerField error={fieldErrors.siteName} help={language === 'th' ? 'ชื่อที่ผู้อ่านจะเห็นบนหน้าเว็บ' : 'The name readers will see.'} id="site-name" label={language === 'th' ? 'ชื่อเว็บไซต์' : 'Site name'} required>
                  <input aria-describedby="site-name-help" aria-invalid={Boolean(fieldErrors.siteName)} className="installer-control" id="site-name" maxLength={120} onChange={(event) => updateField('siteName', event.target.value)} required value={form.siteName} />
                </InstallerField>
                <InstallerField error={fieldErrors.tagline} help={language === 'th' ? 'ประโยคสั้น ๆ ใต้ชื่อเว็บไซต์' : 'A short line beneath the site name.'} id="tagline" label="Tagline">
                  <input aria-describedby="tagline-help" aria-invalid={Boolean(fieldErrors.tagline)} className="installer-control" id="tagline" maxLength={120} onChange={(event) => updateField('tagline', event.target.value)} placeholder={language === 'th' ? 'พื้นที่สำหรับไอเดียที่ควรเก็บไว้' : 'A place for ideas worth keeping'} value={form.tagline} />
                </InstallerField>
                <InstallerField error={fieldErrors.siteDescription} help={language === 'th' ? 'แนะนำไม่เกิน 160 ตัวอักษร' : 'Keep it under 160 characters.'} id="site-description" label={language === 'th' ? 'คำอธิบายเว็บไซต์' : 'Site description'}>
                  <textarea aria-describedby="site-description-help" aria-invalid={Boolean(fieldErrors.siteDescription)} className="installer-control" id="site-description" maxLength={160} onChange={(event) => updateField('siteDescription', event.target.value)} value={form.siteDescription} />
                </InstallerField>
                <div className="installer-field-grid">
                  <InstallerField help={language === 'th' ? 'ใช้กับหน้าเว็บและรูปแบบวันที่' : 'Used for pages and date formatting.'} id="default-locale" label={language === 'th' ? 'ภาษาเริ่มต้น' : 'Default language'}>
                    <UiSelect ariaDescribedBy="default-locale-help" className="installer-control" id="default-locale" onValueChange={(value) => updateField('defaultLocale', value === 'en' ? 'en' : 'th')} options={[{ label: 'ไทย', value: 'th' }, { label: 'English', value: 'en' }]} value={form.defaultLocale} />
                  </InstallerField>
                  <InstallerField help={language === 'th' ? 'ใช้กำหนดเวลาเผยแพร่บทความ' : 'Used to schedule publication.'} id="timezone" label={language === 'th' ? 'เขตเวลา' : 'Timezone'}>
                    <UiSelect ariaDescribedBy="timezone-help" className="installer-control" id="timezone" onValueChange={(value) => updateField('timezone', value === 'UTC' ? 'UTC' : 'Asia/Bangkok')} options={[{ label: 'Asia/Bangkok', value: 'Asia/Bangkok' }, { label: 'UTC', value: 'UTC' }]} value={form.timezone} />
                  </InstallerField>
                </div>
                <InstallerField error={fieldErrors.adminPath} help={language === 'th' ? 'เช่น /studio — บันทึก URL นี้ไว้หลังติดตั้ง' : 'For example /studio — bookmark this URL after setup.'} id="admin-path" label={language === 'th' ? 'URL สำหรับ Admin' : 'Admin path'} required>
                  <input aria-describedby="admin-path-help" aria-invalid={Boolean(fieldErrors.adminPath)} autoCapitalize="none" className="installer-control" id="admin-path" maxLength={41} onChange={(event) => updateField('adminPath', event.target.value)} pattern="/[a-z0-9][a-z0-9-]{1,39}" required spellCheck={false} value={form.adminPath} />
                </InstallerField>
              </div>
              <WizardActions back={copy.back} busy={busy} next={language === 'th' ? 'ข้อมูลเจ้าของ' : 'Owner identity'} onBack={back} onNext={nextFormStep} />
            </>}

            {step === 3 && <>
              <div className="installer-step-head"><h2 ref={heading} tabIndex={-1}>{language === 'th' ? 'ข้อมูลเจ้าของเว็บไซต์' : 'Owner identity'}</h2><p>{language === 'th' ? 'ไม่มีรหัสผ่าน อุปกรณ์ของคุณจะเก็บ Passkey ให้' : 'There is no password. Your device stores the Passkey.'}</p></div>
              <div className="installer-fields">
                <InstallerField error={fieldErrors.email} help={language === 'th' ? 'ใช้ระบุบัญชีและกู้คืนสิทธิ์ในอนาคต' : 'Used to identify the account and support future recovery.'} id="owner-email" label={language === 'th' ? 'อีเมลเจ้าของ' : 'Owner email'} required>
                  <input aria-describedby="owner-email-help" aria-invalid={Boolean(fieldErrors.email)} autoCapitalize="none" autoComplete="email" className="installer-control" id="owner-email" inputMode="email" maxLength={254} onChange={(event) => updateField('email', event.target.value)} placeholder="you@example.com" required spellCheck={false} type="email" value={form.email} />
                </InstallerField>
              </div>
              <WizardActions back={copy.back} busy={busy} next={language === 'th' ? 'ยืนยัน Installation token' : 'Verify installation token'} onBack={back} onNext={nextFormStep} />
            </>}

            {step === 4 && <>
              <div className="installer-step-head"><h2 ref={heading} tabIndex={-1}>Installation token</h2><p>{language === 'th' ? 'Token นี้ยืนยันว่าคุณควบคุมเครื่องที่กำลังติดตั้ง' : 'This token proves you control the machine being installed.'}</p></div>
              <div className="installer-fields">
                <InstallerField help={language === 'th' ? 'ระบบใช้เพื่อตรวจสอบครั้งเดียวและไม่บันทึก token' : 'Used once for verification and never stored.'} id="installation-token" label="Installation token" required>
                  <input aria-describedby="installation-token-help" autoComplete="off" className="installer-control" id="installation-token" maxLength={512} onChange={(event) => updateField('installationToken', event.target.value)} placeholder={language === 'th' ? 'วาง token ที่นี่' : 'Paste the token here'} required type="password" value={form.installationToken} />
                </InstallerField>
                <details className="installer-help">
                  <summary>{language === 'th' ? 'Installation token อยู่ที่ไหน?' : 'Where is the installation token?'}</summary>
                  <div className="installer-help-options">
                    <div className="installer-help-option"><p><strong>Local</strong> — {language === 'th' ? 'รันจากโฟลเดอร์โปรเจกต์:' : 'run from the project folder:'}</p><code>grep '^TOME_CMS_INSTALL_TOKEN=' .env.local</code></div>
                    <div className="installer-help-option"><p><strong>VPS</strong> — {language === 'th' ? 'รันบนเซิร์ฟเวอร์:' : 'run on the server:'}</p><code>sudo grep '^TOME_CMS_INSTALL_TOKEN=' /etc/tome-cms/tome-cms.env</code></div>
                  </div>
                </details>
              </div>
              <WizardActions back={copy.back} busy={busy} next={language === 'th' ? 'ตรวจ token' : 'Verify token'} onBack={back} onNext={() => void enroll()} />
            </>}

            {step === 5 && <>
              <div className="installer-step-head"><h2 ref={heading} tabIndex={-1}>{language === 'th' ? 'สร้าง Passkey หลัก' : 'Create the primary Passkey'}</h2><p>{language === 'th' ? 'เบราว์เซอร์จะแสดงหน้าต่างยืนยันจากอุปกรณ์ของคุณ' : 'Your browser will open the secure confirmation provided by your device.'}</p></div>
              <dl className="installer-review">
                <div className="installer-review-row"><dt>{language === 'th' ? 'เว็บไซต์' : 'Website'}</dt><dd>{form.siteName}</dd></div>
                <div className="installer-review-row"><dt>{language === 'th' ? 'เจ้าของ' : 'Owner'}</dt><dd>{form.email}</dd></div>
                <div className="installer-review-row"><dt>Passkey RP</dt><dd>{rp?.name} · {rp?.id}</dd></div>
                <div className="installer-review-row"><dt>Admin URL</dt><dd>{form.adminPath}</dd></div>
              </dl>
              <div className="installer-actions">
                {!registrationStarted && <button className="installer-button" disabled={busy} onClick={back} type="button">{copy.back}</button>}
                {registrationStarted && alert && <button className="installer-button" disabled={busy} onClick={restartEnrollment} type="button">{language === 'th' ? 'ยืนยัน token ใหม่' : 'Verify a new token'}</button>}
                <button className="installer-button installer-button--primary" data-state={busy ? 'loading' : undefined} disabled={busy} onClick={() => void registerAndFinalize()} type="button">{passkeyRegistered ? (language === 'th' ? 'ลองบันทึกการติดตั้งอีกครั้ง' : 'Retry finalization') : (language === 'th' ? 'สร้าง Passkey และติดตั้ง' : 'Create Passkey and install')}</button>
              </div>
            </>}

            {step === 6 && <>
              <div className="installer-step-head"><h2 ref={heading} tabIndex={-1}>{language === 'th' ? 'เก็บ Recovery codes' : 'Save the recovery codes'}</h2><p>{language === 'th' ? 'แต่ละรหัสใช้ได้ครั้งเดียว และจะไม่แสดงอีกหลังออกจากหน้านี้' : 'Each code works once and will not be shown again after you leave this page.'}</p></div>
              <textarea aria-label={language === 'th' ? 'Recovery codes แบบแสดงครั้งเดียว' : 'One-time recovery codes'} className="installer-recovery-codes" readOnly ref={recoveryField} rows={10} value={recoveryCodes.join('\n')} />
              <div className="installer-recovery-actions">
                <button className="installer-button" onClick={() => void copyRecoveryCodes()} type="button">{copyStatus === 'copied' ? (language === 'th' ? 'คัดลอกแล้ว' : 'Copied') : copyStatus === 'selected' ? (language === 'th' ? 'เลือกข้อความแล้ว' : 'Codes selected') : (language === 'th' ? 'คัดลอก' : 'Copy')}</button>
                <button className="installer-button" onClick={downloadRecoveryCodes} type="button">{language === 'th' ? 'ดาวน์โหลด .txt' : 'Download .txt'}</button>
              </div>
              <label className="installer-acknowledgement"><input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" /><span>{language === 'th' ? 'ฉันเก็บ Recovery codes ไว้ในที่ปลอดภัยแล้ว' : 'I saved the recovery codes somewhere safe.'}</span></label>
              <div className="installer-actions"><button className="installer-button installer-button--primary" disabled={!acknowledged} onClick={() => window.location.assign(redirectTo)} type="button">{language === 'th' ? 'ไปที่ Admin' : 'Continue to Admin'} <span aria-hidden="true">→</span></button></div>
            </>}
          </section>
        </form>
      </section>
    </>
  );
}

function InstallerField({ children, error, help, id, label, required = false }: {
  children: React.ReactNode;
  error?: string;
  help: string;
  id: string;
  label: string;
  required?: boolean;
}) {
  return <div className="installer-field"><label htmlFor={id}>{label}{required && <span className="installer-required-mark" aria-hidden="true"> *</span>}</label>{children}<p className="installer-helper" data-tone={error ? 'error' : undefined} id={`${id}-help`}>{error ?? help}</p></div>;
}

function WizardActions({ back, busy, next, onBack, onNext }: {
  back: string;
  busy: boolean;
  next: string;
  onBack: () => void;
  onNext: () => void;
}) {
  return <div className="installer-actions"><button className="installer-button" disabled={busy} onClick={onBack} type="button">{back}</button><button className="installer-button installer-button--primary" data-state={busy ? 'loading' : undefined} disabled={busy} onClick={onNext} type="button">{next} <span aria-hidden="true">→</span></button></div>;
}
