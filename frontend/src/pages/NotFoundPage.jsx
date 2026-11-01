import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { Card, EmptyState } from '../components/ui.jsx';

export default function NotFoundPage() {
  return (
    <Card>
      <EmptyState icon={SearchX} title="Página no encontrada">
        La página no existe o no está disponible para su rol.{' '}
        <Link to="/" className="font-semibold text-primary">
          Volver al tablero
        </Link>
      </EmptyState>
    </Card>
  );
}
