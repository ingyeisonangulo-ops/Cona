import { useSearchParams } from 'react-router-dom';
import { PageHeader, Segmented } from '../components/ui.jsx';
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
      <Segmented
        label="Catálogo"
        className="mb-5"
        value={current[0]}
        onChange={(id) => setParams(id === 'servicios' ? {} : { tab: id }, { replace: true })}
        options={tabs.map(([id, label]) => ({ value: id, label }))}
      />
      <div role="tabpanel">
        <Tab key={current[0]} canWrite={canWrite} showMoney={showMoney} />
      </div>
    </>
  );
}
