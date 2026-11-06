import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { useShallow } from 'zustand/react/shallow';

export default function Avatar({ size = 28 }: { size?: number }) {
  const name = useAuth(s => s.user?.name ?? '?');
  // Only what it draws: not redrawn (on every page) when another setting changes.
  const { avatarColor, avatarImage } = useSettings(useShallow(s => ({ avatarColor: s.avatarColor, avatarImage: s.avatarImage })));
  if (avatarImage) {
    return <img src={avatarImage} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: avatarColor, fontSize: Math.round(size * 0.42) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
