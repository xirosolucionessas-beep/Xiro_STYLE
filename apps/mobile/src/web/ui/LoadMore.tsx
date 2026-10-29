import { Button } from './Button';

export interface LoadMoreState {
  hasMore: boolean;
  loading: boolean;
  /** Mensaje si falló la página siguiente (lo ya cargado se conserva). */
  error?: string;
  onLoadMore: () => void;
}

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * "Cargar más" al pie de una tabla paginada por cursor. En escritorio es más claro y accesible que el scroll infinito:
 * es un botón real (teclado, lector de pantalla) y anuncia el estado de carga y los errores.
 */
export function LoadMore({ state, t }: { state: LoadMoreState; t: T }) {
  if (state.error) {
    return (
      <div className="xw-loadmore" role="alert">
        <p className="xw-hint">{state.error}</p>
        <Button variant="secondary" onPress={state.onLoadMore}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (!state.hasMore) return null;
  return (
    <div className="xw-loadmore">
      <Button variant="secondary" loading={state.loading} loadingLabel={t('loading')} onPress={state.onLoadMore}>
        {t('load_more')}
      </Button>
    </div>
  );
}
