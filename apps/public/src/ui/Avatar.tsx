import { useRef } from 'react';
import { Icon } from './Icon';

/**
 * Avatar circular de una persona (cliente): la foto que subió, o sus iniciales sobre un degradado dorado (nunca un
 * color plano) cuando no hay foto. Con `onPick`, muestra un botón para agregar/cambiar la foto (registro y "Mi perfil");
 * sin él, es de solo lectura (p. ej. la barra superior).
 */
export function Avatar({ src, name, size = 96, onPick, busy, pickLabel }: { src: string | null; name: string; size?: number; onPick?: (file: File) => void; busy?: boolean; pickLabel?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="xp-avatar" style={{ width: size, height: size }}>
      {src ? (
        <img className="xp-avatar-img" src={src} alt="" />
      ) : (
        <span className="xp-avatar-fallback" aria-hidden="true" style={{ fontSize: size * 0.4 }}>
          {initial}
        </span>
      )}
      {onPick ? (
        <>
          <button type="button" className="xp-avatar-edit" aria-label={pickLabel} disabled={busy} onClick={() => inputRef.current?.click()}>
            <Icon name="image" size={16} />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="xp-sr"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onPick(file);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
