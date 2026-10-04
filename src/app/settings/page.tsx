import { redirect } from 'next/navigation';

/**
 * User-managed provider keys were retired. Keep the old URL harmless for
 * bookmarks, but send visitors to their account rather than exposing an AI
 * settings or full-page assistant surface.
 */
export default function SettingsPage() {
  redirect('/account');
}
