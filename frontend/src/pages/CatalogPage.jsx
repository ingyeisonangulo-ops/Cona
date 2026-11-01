import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import CategoriasTab from './catalog/CategoriasTab.jsx';
import ConveniosTab from './catalog/ConveniosTab.jsx';
import ServiciosTab from './catalog/ServiciosTab.jsx';

const TABS = [
  ['servicios', 'Servicios', ServiciosTab],
  ['categorias', 'Categorías', CategoriasTab],
  ['convenios', 'Convenios', ConveniosTab],
];

export default function CatalogPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  // Colaborador: sin convenios ni cifras en dinero (también lo impone la API).
  const showMoney = can('MANAGE_SERVICES', 'REGISTER_SERVICES');
  const tabs = TABS.filter(([id]) => id !== 'convenios' || showMoney);
  const current = tabs.find(([id]) => id === params.get('tab')) ?? tabs[0];
  const [, , Tab] = current;
  // La UI oculta acciones de escritura; el backend las valida igualmente.
  const canWrite = can('MANAGE_SERVICES');

  return (
    <>
      <PageHeader
        title="Servicios y convenios"
        description={canWrite ? 'Administre el catálogo de la clínica.' : 'Consulta del catálogo vigente.'}
      />
      <div role="tablist" aria-label="Catálogo" className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1">
        {tabs.map(([id, label]) => {
          const active = id === current[0];
          return (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setParams(id === 'servicios' ? {} : { tab: id }, { replace: true })}
              className={`touch-target flex-1 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors ${
                active ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-primary'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">
        <Tab key={current[0]} canWrite={canWrite} showMoney={showMoney} />
      </div>
    </>
  );
}
