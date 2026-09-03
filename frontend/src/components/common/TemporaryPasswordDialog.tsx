import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';

/** What approving produced: the address they sign in with, and the secret, once. */
export interface HandedOverCredential {
  email: string;
  temporaryPassword: string;
}

/**
 * The one-time secret.
 *
 * ⚠ THIS VALUE CANNOT BE READ BACK. There is no email adapter in this
 * deployment, so this dialog is the only channel that will ever carry it to the
 * person it belongs to. It is never stored in plaintext, never logged, and no
 * endpoint can produce it again — which is why the dialog says so plainly
 * rather than letting somebody close it assuming they can look it up later.
 *
 * Shared by every approval that creates an account — an employee invitation
 * and a driver request alike — because the hand-over is the same act.
 */
export function TemporaryPasswordDialog({
  credential,
  onClose,
}: Readonly<{ credential: HandedOverCredential | null; onClose: () => void }>) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // ★ RESET WHEN THE CREDENTIAL CHANGES. Without this, approving a second
  // request opens a dialog already reading "Copied" — for a value nobody has
  // copied. On a secret that cannot be recovered, that is the worst possible
  // thing to be wrong about.
  const shownFor = useRef<string | null>(null);
  if (credential && shownFor.current !== credential.temporaryPassword) {
    shownFor.current = credential.temporaryPassword;
    if (copied) setCopied(false);
    if (copyFailed) setCopyFailed(false);
  }
  if (!credential) {
    if (shownFor.current !== null) shownFor.current = null;
  }

  if (!credential) return null;

  const copy = async () => {
    // `navigator.clipboard` is absent outside a secure context, and `writeText`
    // rejects when permission is refused. Either way the value is NOT on the
    // clipboard, and saying "Copied" would send somebody away believing they
    // have a credential they cannot get back.
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.');
      await navigator.clipboard.writeText(credential.temporaryPassword);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('temporaryPasswordTitle')}
      footer={
        <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-700">
          {t('done')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t('temporaryPasswordBody')}</p>

        {/*
          ★ THE FULL ADDRESS, NOT THE LOCAL PART. `POST /auth/login` takes the
          whole address as `subject`; a local part read out loud sent people to
          a login that could only fail.
        */}
        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500">{t('loginEmailLabel')}</span>
          <p className="font-mono text-sm text-gray-900">{credential.email}</p>
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500">{t('temporaryPasswordTitle')}</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-gray-100 px-3 py-2 font-mono text-sm text-gray-900 break-all">
              {credential.temporaryPassword}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
          {copyFailed && (
            <p role="alert" className="text-sm text-red-600">
              {t('copyFailed')}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
