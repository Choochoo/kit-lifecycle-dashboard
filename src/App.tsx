import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  ArrowUpRight,
  Box,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  FileSpreadsheet,
  Info,
  Layers3,
  LoaderCircle,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import { parseDataset } from './csv';
import {
  buildSnapshot,
  DEFAULT_AS_OF,
  type Dataset,
  type Filters,
  type ImportDiagnostics,
  type KitHistory,
  type OrderRow,
  type Snapshot,
} from './domain';

const number = new Intl.NumberFormat('en-US');
const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});
const eventLabels: Record<string, string> = {
  kit_shipped: 'Kit shipped',
  kit_delivered: 'Kit delivered',
  sample_mailed: 'Sample mailed',
  sample_received: 'Sample received at lab',
  qc_passed: 'Quality control passed',
  qc_failed: 'Quality control failed',
  sequencing_complete: 'Sequencing complete',
  report_ready: 'Report ready',
  kit_replaced: 'Kit replaced',
};
const productLabel = (product: string) =>
  ({ wgs_30x: 'WGS 30×', wgs_100x: 'WGS 100×', upload_only: 'Upload only' })[
    product
  ] ?? product;
const days = (value: number | null) =>
  value === null ? '—' : `${value.toFixed(1)}d`;
const date = (value: string) => dayFormatter.format(new Date(value));
const PAGE_SIZE = 15;

function Metric({
  title,
  value,
  icon,
  note,
  className = '',
}: {
  title: string;
  value: string;
  icon: ReactNode;
  note: ReactNode;
  className?: string;
}) {
  return (
    <div className={`metric ${className}`}>
      <div className="metric-top">
        <span className="metric-title">{title}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-bottom">{note}</div>
    </div>
  );
}

function StagePill({ row }: { row: OrderRow }) {
  return (
    <span
      className={`stage-pill ${row.completed ? 'done' : row.needsAttention ? 'warn' : row.stage === 'awaiting_shipment' ? 'neutral' : ''}`}
    >
      <span className="pill-dot" />
      {row.stageLabel}
    </span>
  );
}

function Pipeline({ snapshot }: { snapshot: Snapshot }) {
  const max = Math.max(1, ...snapshot.stageCounts.map((stage) => stage.count));
  return (
    <section className="panel" aria-labelledby="pipeline-title">
      <div className="panel-head">
        <div>
          <h2 id="pipeline-title">Where orders are now</h2>
          <p className="panel-subtitle">One current state per order</p>
        </div>
        <span className="tag">
          <Layers3 size={11} /> Pipeline
        </span>
      </div>
      <div className="pipeline">
        {snapshot.stageCounts.map((stage) => (
          <div
            key={stage.stage}
            className={`pipeline-row ${stage.stage === 'completed' ? 'is-completed' : stage.stage === 'qc_failed' ? 'is-attention' : ''}`}
          >
            <span className="pipeline-label">
              <span className="pipeline-dot" />
              {stage.label}
            </span>
            <div className="pipeline-bar-track">
              <div
                className="pipeline-bar"
                style={{ width: `${(stage.count / max) * 100}%` }}
              />
            </div>
            <span className="pipeline-count">{number.format(stage.count)}</span>
          </div>
        ))}
        <p className="pipeline-footnote">
          Replaced kits stay in the order history. Only the current kit counts
          toward its state.
        </p>
      </div>
    </section>
  );
}

function Turnaround({ snapshot }: { snapshot: Snapshot }) {
  const [product, setProduct] = useState('all');
  return (
    <section className="panel" aria-labelledby="turnaround-title">
      <div className="panel-head">
        <div>
          <h2 id="turnaround-title">Stage turnaround</h2>
          <p className="panel-subtitle">Calendar days · observed transitions</p>
        </div>
        <div className="segmented" aria-label="Turnaround product">
          <button
            className={product === 'all' ? 'active' : ''}
            aria-pressed={product === 'all'}
            onClick={() => setProduct('all')}
          >
            All
          </button>
          {snapshot.options.products.map((item) => (
            <button
              key={item}
              className={product === item ? 'active' : ''}
              aria-pressed={product === item}
              onClick={() => setProduct(item)}
            >
              {item === 'wgs_30x' ? '30×' : item === 'wgs_100x' ? '100×' : item}
            </button>
          ))}
        </div>
      </div>
      <div className="table-scroll">
        <table className="duration-table">
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">Target</th>
              <th scope="col">Median</th>
              <th scope="col">P90</th>
              <th scope="col">n</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.durations.map((stage) => {
              const stats =
                product === 'all'
                  ? stage.overall
                  : stage.byProduct.find((item) => item.product === product);
              return (
                <tr key={stage.stage}>
                  <td>{stage.label}</td>
                  <td>
                    <small>≤ {stage.targetDays}d</small>
                  </td>
                  <td
                    className={
                      stats?.medianDays != null &&
                      stats.medianDays > stage.targetDays
                        ? 'over-target'
                        : ''
                    }
                  >
                    {days(stats?.medianDays ?? null)}
                  </td>
                  <td
                    className={
                      stats?.p90Days != null && stats.p90Days > stage.targetDays
                        ? 'over-target'
                        : ''
                    }
                  >
                    {days(stats?.p90Days ?? null)}
                  </td>
                  <td>{number.format(stats?.count ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-footnote">
        <Info size={11} /> P90: 90% of observed transitions finished within this
        time. Missing endpoints are excluded.
      </p>
    </section>
  );
}

function Orders({
  snapshot,
  onSelect,
  searching,
}: {
  snapshot: Snapshot;
  onSelect: (row: OrderRow) => void;
  searching: boolean;
}) {
  const [tab, setTab] = useState<'attention' | 'all'>('attention');
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (searching) setTab('all');
  }, [searching]);
  useEffect(() => {
    setPage(0);
  }, [snapshot, tab]);
  const rows = tab === 'attention' ? snapshot.attention : snapshot.rows;
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageRows = rows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  return (
    <section className="panel" aria-labelledby="orders-title">
      <div className="panel-head queue-head">
        <div>
          <div className="queue-title-group">
            <h2 id="orders-title">Order worklist</h2>
            <span className="count-badge">
              {number.format(snapshot.rows.length)}
            </span>
          </div>
          <p className="panel-subtitle">
            Find a kit, see its history, and decide what needs a follow-up.
          </p>
        </div>
        <div className="queue-controls">
          <span className="tag">
            <SlidersHorizontal size={11} /> Filtered cohort
          </span>
        </div>
      </div>
      <div className="queue-tabs" aria-label="Order worklist">
        <button
          className={tab === 'attention' ? 'active' : ''}
          aria-pressed={tab === 'attention'}
          onClick={() => setTab('attention')}
        >
          <CircleAlert size={12} />
          Needs attention
          <span className="count-badge">
            {number.format(snapshot.attention.length)}
          </span>
        </button>
        <button
          className={tab === 'all' ? 'active' : ''}
          aria-pressed={tab === 'all'}
          onClick={() => setTab('all')}
        >
          All orders
          <span className="count-badge">
            {number.format(snapshot.rows.length)}
          </span>
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <CheckCheck size={29} />
          <p>
            {tab === 'attention'
              ? 'No orders need attention in this view.'
              : 'No orders match these filters.'}
          </p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="orders-table">
              <thead>
                <tr>
                  <th scope="col">Order / kit</th>
                  <th scope="col">Product</th>
                  <th scope="col">Country</th>
                  <th scope="col">Current stage</th>
                  <th scope="col">Time in stage</th>
                  <th scope="col">Follow-up</th>
                  <th scope="col">
                    <span className="muted">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.orderId} className="order-row">
                    <td>
                      <button
                        className="order-button"
                        onClick={() => onSelect(row)}
                      >
                        <span className="order-id mono">{row.orderId}</span>
                        {row.kitCount > 1 && (
                          <span
                            className="tag"
                            title={`${row.kitCount} kits in this order`}
                          >
                            {row.kitCount} kits
                          </span>
                        )}
                      </button>
                      <span className="order-subtext mono">
                        {row.kitId ?? 'Shipment pending'}
                      </span>
                    </td>
                    <td>
                      <span className="product">
                        {productLabel(row.product)}
                      </span>
                    </td>
                    <td>
                      <span className="country">{row.country}</span>
                    </td>
                    <td>
                      <StagePill row={row} />
                    </td>
                    <td>
                      <span className="elapsed">
                        {row.completed ? '—' : days(row.elapsedDays)}
                      </span>
                    </td>
                    <td>
                      {row.stage === 'qc_failed' ? (
                        <span className="overdue-badge qc-badge">
                          <CircleAlert size={10} />
                          QC failed
                        </span>
                      ) : row.needsAttention ? (
                        <span className="overdue-badge">
                          <Clock3 size={10} />
                          {days(row.overdueDays)} overdue
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="row-arrow"
                        aria-label={`View order ${row.orderId}`}
                        onClick={() => onSelect(row)}
                      >
                        <ArrowUpRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              Showing {number.format(currentPage * PAGE_SIZE + 1)}–
              {number.format(
                Math.min(rows.length, (currentPage + 1) * PAGE_SIZE),
              )}{' '}
              of {number.format(rows.length)} orders
            </span>
            <div className="pagination-buttons">
              <span>
                {currentPage + 1} / {lastPage + 1}
              </span>
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={13} />
              </button>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function DataDetails({
  diagnostics,
  label,
}: {
  diagnostics: ImportDiagnostics;
  label: string;
}) {
  const excluded = diagnostics.excludedOrders;
  return (
    <details className="data-details">
      <summary>
        <Database size={12} />
        Data quality & calculation rules
        <ChevronDown size={12} />
      </summary>
      <div className="data-policy">
        <div>
          <strong>Import summary · {label}</strong>
          <ul className="diagnostics-list">
            <li>
              {number.format(diagnostics.ordersRead)} order rows ·{' '}
              {number.format(diagnostics.eventsRead)} event rows read
            </li>
            <li>
              {number.format(diagnostics.duplicateEvents)} duplicate events
              removed · {number.format(diagnostics.orphanEvents)} orphan events
              excluded
            </li>
            <li>
              {number.format(diagnostics.naiveTimestamps)} timestamps without a
              timezone treated as UTC
            </li>
            <li>
              {number.format(diagnostics.invalidOrders)} invalid order rows ·{' '}
              {number.format(diagnostics.invalidEvents)} invalid event rows
              excluded
            </li>
            <li>
              {number.format(diagnostics.duplicateOrders)} duplicate order rows
              removed
            </li>
            <li>
              Excluded orders: {number.format(excluded.test)} test ·{' '}
              {number.format(excluded.status)} unpaid/cancelled/refunded ·{' '}
              {number.format(excluded.uploadOnly)} upload only
            </li>
            {diagnostics.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
        <div>
          <strong>How this view works</strong>
          <p>
            Paid, non-test physical orders only. Date filters use order creation
            in UTC. The snapshot is at 00:00 UTC on the selected date; later
            events are hidden. Stage age uses elapsed calendar days, and
            follow-up begins when age exceeds the target.
          </p>
          <p>
            Replacement shipment clocks start at the replacement event. Missing
            scans do not create timestamps or stage durations. QC failures need
            follow-up immediately. Stage times include observed historical kits,
            with median, P90, and sample size shown.
          </p>
        </div>
      </div>
    </details>
  );
}

function KitTimeline({ kit }: { kit: KitHistory }) {
  const types = new Set(kit.events.map((event) => event.type));
  const missing: string[] = [];
  const milestones = [
    'kit_shipped',
    'kit_delivered',
    'sample_mailed',
    'sample_received',
    'qc_passed',
    'sequencing_complete',
    'report_ready',
  ];
  const furthest = Math.max(
    -1,
    ...kit.events.map((event) => milestones.indexOf(event.type)),
  );
  for (let index = 0; index < furthest; index++) {
    const milestone = milestones[index];
    if (
      !types.has(milestone as KitHistory['events'][number]['type']) &&
      !(milestone === 'qc_passed' && types.has('qc_failed'))
    )
      missing.push(eventLabels[milestone]);
  }
  return (
    <section className="kit-section">
      <div className="kit-heading">
        <h3>{kit.kitId}</h3>
        <span className={`stage-pill ${kit.replaced ? 'neutral' : 'done'}`}>
          {kit.replaced
            ? 'Replaced'
            : kit.active
              ? 'Current kit'
              : 'Historical kit'}
        </span>
      </div>
      <ol className="timeline">
        {kit.events.map((event) => (
          <li key={event.eventId}>
            <span className="timeline-dot" />
            <div>
              <p className="timeline-event">
                {eventLabels[event.type] ?? event.type}
              </p>
              <p className="timeline-meta">
                {timeFormatter.format(new Date(event.occurredAt))} UTC
                <span className="timeline-source">{event.source}</span>
              </p>
            </div>
          </li>
        ))}
      </ol>
      {missing.length > 0 && (
        <p className="missing-note">
          Missing scan{missing.length > 1 ? 's' : ''}: {missing.join(', ')}.
          Later events show progress; no time is inferred for these steps.
        </p>
      )}
    </section>
  );
}

function OrderDrawer({
  order,
  onClose,
}: {
  order: OrderRow | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (order && !ref.current?.open) ref.current?.showModal();
    else if (!order && ref.current?.open) ref.current.close();
  }, [order]);
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="order-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (event.clientX < rect.left) onClose();
        }
      }}
    >
      {order && (
        <>
          <div className="dialog-head">
            <div>
              <p className="eyebrow">Order history</p>
              <h2 id="order-title">{order.orderId}</h2>
              <p>Full kit history through the selected snapshot · UTC</p>
            </div>
            <button
              className="icon-button"
              aria-label="Close order details"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
          <div className="dialog-body">
            <dl className="order-facts">
              <div>
                <dt>Product</dt>
                <dd>{productLabel(order.product)}</dd>
              </div>
              <div>
                <dt>Country</dt>
                <dd>{order.country}</dd>
              </div>
              <div>
                <dt>Order placed</dt>
                <dd>{date(order.createdAt)}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd className="mono">{order.customerId}</dd>
              </div>
              <div>
                <dt>Physical kits</dt>
                <dd>{order.kitCount}</dd>
              </div>
              <div>
                <dt>Current stage</dt>
                <dd>
                  <StagePill row={order} />
                </dd>
              </div>
            </dl>
            {order.needsAttention && (
              <div className="order-attention">
                <CircleAlert size={15} />
                <div>
                  {order.attentionReason}
                  <br />
                  {days(order.elapsedDays)} in this stage
                  {order.targetDays !== null
                    ? ` · ${order.targetDays}d target`
                    : ''}
                </div>
              </div>
            )}
            {order.kits.length ? (
              order.kits.map((kit) => <KitTimeline key={kit.kitId} kit={kit} />)
            ) : (
              <p className="empty">
                No kit events recorded. Awaiting the first shipment.
              </p>
            )}
            <p className="drawer-note">
              Events are normalized to UTC, deduplicated by order, kit,
              milestone, and timestamp, then sorted chronologically.
            </p>
          </div>
        </>
      )}
    </dialog>
  );
}

function ImportDialog({
  open,
  onClose,
  onImport,
  asOf,
  onRestore,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (dataset: Dataset, label: string, asOf: string) => void;
  asOf: string;
  onRestore: () => Promise<void>;
  loading: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && !ref.current?.open) {
      setError('');
      ref.current?.showModal();
    } else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const orders = data.get('orders') as File;
      const events = data.get('events') as File;
      if (!orders?.size || !events?.size)
        throw new Error('Choose both CSV files before importing.');
      if (orders.size + events.size > 50 * 1024 * 1024)
        throw new Error('Please keep the combined CSV size under 50 MB.');
      const [ordersCsv, eventsCsv] = await Promise.all([
        orders.text(),
        events.text(),
      ]);
      const dataset = parseDataset(ordersCsv, eventsCsv);
      onImport(
        dataset,
        `${orders.name} + ${events.name}`,
        String(data.get('snapshot') || asOf),
      );
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not import these files.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="import-dialog"
      aria-labelledby="import-title"
      onClose={onClose}
    >
      <div className="dialog-head">
        <div>
          <h2 id="import-title">Load a new snapshot</h2>
          <p>Replace both CSVs together. Your files stay in this browser.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close import"
          onClick={onClose}
        >
          <X size={17} />
        </button>
      </div>
      <div className="dialog-body">
        <form className="import-form" onSubmit={submit}>
          <label className="field">
            <span>Orders CSV</span>
            <input type="file" name="orders" accept=".csv,text/csv" required />
            <small>
              order_id, created_at, customer_id, product, country, status,
              is_test
            </small>
          </label>
          <label className="field">
            <span>Kit events CSV</span>
            <input type="file" name="events" accept=".csv,text/csv" required />
            <small>
              event_id, order_id, kit_id, event_type, occurred_at, source
            </small>
          </label>
          <label className="field">
            <span>Snapshot date · 00:00 UTC</span>
            <input type="date" name="snapshot" defaultValue={asOf} required />
            <small>
              Choose the date the export represents. Events after this point are
              hidden.
            </small>
          </label>
          <p className="import-note">
            Same columns, any row order. Duplicate events and orphan rows are
            handled automatically. The import replaces the current data only
            after both files validate.
          </p>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="ghost"
              disabled={busy || loading}
              onClick={async () => {
                await onRestore();
                onClose();
              }}
            >
              <RotateCcw size={13} />
              Sample data
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || loading}
            >
              {busy ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Upload size={14} />
              )}
              {busy ? 'Reading files…' : 'Load snapshot'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [filters, setFilters] = useState<Filters>({ asOf: DEFAULT_AS_OF });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('Sample export');
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const snapshot = useMemo(
    () => (dataset ? buildSnapshot(dataset, filters) : null),
    [dataset, filters],
  );
  async function loadSample() {
    setLoading(true);
    setError('');
    try {
      const responses = await Promise.all([
        fetch('./data/orders.csv'),
        fetch('./data/kit_events.csv'),
      ]);
      if (responses.some((response) => !response.ok))
        throw new Error(
          'The sample files could not be loaded. You can import your own CSVs instead.',
        );
      const [ordersCsv, eventsCsv] = await Promise.all(
        responses.map((response) => response.text()),
      );
      setDataset(parseDataset(ordersCsv, eventsCsv));
      setLabel('Sample export');
      setFilters({ asOf: DEFAULT_AS_OF });
      setSelected(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not load the sample data.',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadSample();
  }, []);
  const update = (key: keyof Filters, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const imported = (next: Dataset, nextLabel: string, asOf: string) => {
    setDataset(next);
    setLabel(nextLabel);
    setFilters({ asOf });
    setSelected(null);
    setError('');
  };
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-symbol">
            <Activity size={20} strokeWidth={2.2} />
          </span>
          nebula
          <span className="brand-separator" />
          <span className="workspace-name">Operations workspace</span>
        </div>
        <div className="header-right">
          <span className="sample-status">
            <span className="status-dot" />
            {label === 'Sample export'
              ? 'Sample data connected'
              : 'Custom data loaded'}
          </span>
          <span className="avatar" aria-label="Operations">
            OP
          </span>
        </div>
      </header>
      <main className="page">
        <div className="page-heading">
          <div>
            <p className="eyebrow">
              <Layers3 size={11} />
              Fulfillment & lab operations
            </p>
            <h1>Kit lifecycle</h1>
            <p className="page-description">
              A clear view of every kit. From first shipment to a ready report.
            </p>
          </div>
          <div className="heading-actions">
            <div className="snapshot-control">
              <label htmlFor="as-of">
                <CalendarDays size={13} />
                Snapshot
              </label>
              <input
                id="as-of"
                type="date"
                aria-label="Snapshot date at midnight UTC"
                value={filters.asOf}
                onChange={(event) => {
                  if (event.target.value) update('asOf', event.target.value);
                }}
              />
            </div>
            <button className="primary" onClick={() => setImportOpen(true)}>
              <Upload size={14} />
              Import CSVs
            </button>
          </div>
        </div>
        {error && (
          <div className="error alert-banner" role="alert">
            {error}
          </div>
        )}
        {loading && !snapshot ? (
          <div className="loading" role="status">
            <LoaderCircle className="spin" size={28} />
            <p>Reading the pipeline…</p>
          </div>
        ) : snapshot ? (
          <>
            <div className="filters" aria-label="Order filters">
              <label className="field">
                <span>Order created from</span>
                <input
                  type="date"
                  value={filters.startDate ?? ''}
                  onChange={(event) => update('startDate', event.target.value)}
                />
              </label>
              <label className="field">
                <span>Order created through</span>
                <input
                  type="date"
                  value={filters.endDate ?? ''}
                  onChange={(event) => update('endDate', event.target.value)}
                />
              </label>
              <label className="field">
                <span>Product</span>
                <select
                  value={filters.product ?? 'all'}
                  onChange={(event) => update('product', event.target.value)}
                >
                  <option value="all">All products</option>
                  {snapshot.options.products.map((product) => (
                    <option key={product} value={product}>
                      {productLabel(product)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Country</span>
                <select
                  value={filters.country ?? 'all'}
                  onChange={(event) => update('country', event.target.value)}
                >
                  <option value="all">All countries</option>
                  {snapshot.options.countries.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Search orders</span>
                <span className="search-field">
                  <Search size={14} />
                  <input
                    placeholder="Order, kit or customer ID"
                    value={filters.search ?? ''}
                    onChange={(event) => update('search', event.target.value)}
                  />
                </span>
              </label>
              <button
                className="ghost filter-reset"
                onClick={() => setFilters({ asOf: filters.asOf })}
                aria-label="Reset order filters"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            </div>
            {filters.startDate &&
              filters.endDate &&
              filters.startDate > filters.endDate && (
                <p className="notice inline-error">
                  The start date is after the end date. Adjust the dates to see
                  orders.
                </p>
              )}
            <div className="metrics">
              <Metric
                title="Total orders"
                value={number.format(snapshot.summary.totalOrders)}
                icon={<Box size={17} />}
                note={
                  <>
                    <span className="status-dot" />
                    Paid physical orders in this cohort
                  </>
                }
              />
              <Metric
                title="In progress"
                value={number.format(snapshot.summary.activeOrders)}
                icon={<Layers3 size={17} />}
                note="Across fulfillment and lab stages"
              />
              <Metric
                title="Reports ready"
                value={number.format(snapshot.summary.completedOrders)}
                icon={<CheckCheck size={18} />}
                className="completed"
                note={
                  <>
                    <strong>
                      {snapshot.summary.completionRate.toFixed(1)}%
                    </strong>
                    of this cohort completed
                  </>
                }
              />
              <Metric
                title="Needs attention"
                value={number.format(snapshot.summary.attentionOrders)}
                icon={<CircleAlert size={17} />}
                className="attention"
                note={
                  <>
                    <Clock3 size={11} />
                    Past target or a failed QC result
                  </>
                }
              />
            </div>
            <div className="dashboard-grid">
              <Pipeline snapshot={snapshot} />
              <Turnaround snapshot={snapshot} />
            </div>
            <Orders
              snapshot={snapshot}
              onSelect={setSelected}
              searching={Boolean(filters.search?.trim())}
            />
            <DataDetails diagnostics={snapshot.diagnostics} label={label} />
            <footer className="page-footer">
              <span className="footer-brand">
                <Activity size={12} />
                Nebula Genomics · Kit lifecycle dashboard
              </span>
              <span>
                {label === 'Sample export'
                  ? 'Synthetic data'
                  : 'Browser-local CSV data'}{' '}
                · As of {date(`${filters.asOf}T00:00:00Z`)}, 00:00 UTC
              </span>
            </footer>
          </>
        ) : (
          <div className="empty">
            <FileSpreadsheet size={30} />
            <p>Import an orders CSV and a kit events CSV to get started.</p>
            <button
              className="secondary"
              style={{ marginTop: 15 }}
              onClick={() => setImportOpen(true)}
            >
              <Upload size={14} />
              Import CSVs
            </button>
          </div>
        )}
      </main>
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={imported}
        asOf={filters.asOf}
        onRestore={loadSample}
        loading={loading}
      />
      <OrderDrawer order={selected} onClose={() => setSelected(null)} />
    </>
  );
}
