import { redirect } from 'next/navigation';

/**
 * The full-page assistant was replaced by the floating assistant launcher.
 * Keep this route as a safe redirect for old bookmarks and teammate links;
 * the assistant API remains available to the floating bubble.
 */
export default function AssistantPage() {
  redirect('/hospitals');
}
