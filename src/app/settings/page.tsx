import { redirect } from 'next/navigation';

/**
 * User-managed provider keys were retired. Keep the old URL harmless for
 * bookmarks, but send visitors to the existing assistant instead of exposing
 * a settings surface that suggests BYOK configuration.
 */
export default function SettingsPage() {
  redirect('/assistant');
}
