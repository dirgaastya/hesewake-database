import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui.jsx';

// Satu bagian yang gagal render tidak boleh membuat seluruh halaman kosong.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Gagal menampilkan bagian ini:', error, info.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section role="alert" className="grid max-w-[460px] content-start justify-items-start gap-2 px-6 py-8">
        <AlertTriangle size={18} strokeWidth={1.5} className="text-danger" aria-hidden="true" />
        <h3 className="m-0 text-sm font-semibold">Bagian ini gagal ditampilkan</h3>
        <p className="m-0 font-mono text-xs text-fg-muted">{this.state.error.message}</p>
        <Button size="sm" onClick={() => this.setState({ error: null })}>
          Coba lagi
        </Button>
      </section>
    );
  }
}
