export const DEFAULT_AS_OF = '2026-10-20';

export type PipelineStage =
  | 'awaiting_shipment'
  | 'in_transit'
  | 'with_customer'
  | 'returning'
  | 'qc'
  | 'sequencing'
  | 'reporting';
export type StageId = PipelineStage | 'completed' | 'qc_failed';

export const STAGES: {
  id: PipelineStage;
  label: string;
  durationLabel: string;
  targetDays: number;
}[] = [
  {
    id: 'awaiting_shipment',
    label: 'Awaiting shipment',
    durationLabel: 'Order / replacement → shipped',
    targetDays: 3,
  },
  {
    id: 'in_transit',
    label: 'Kit in transit',
    durationLabel: 'Shipped → delivered',
    targetDays: 7,
  },
  {
    id: 'with_customer',
    label: 'With customer',
    durationLabel: 'Delivered → sample mailed',
    targetDays: 45,
  },
  {
    id: 'returning',
    label: 'Sample returning',
    durationLabel: 'Mailed → received',
    targetDays: 14,
  },
  {
    id: 'qc',
    label: 'In quality control',
    durationLabel: 'Received → QC result',
    targetDays: 7,
  },
  {
    id: 'sequencing',
    label: 'Sequencing',
    durationLabel: 'QC passed → sequenced',
    targetDays: 28,
  },
  {
    id: 'reporting',
    label: 'Preparing report',
    durationLabel: 'Sequenced → report ready',
    targetDays: 5,
  },
];

export type EventType =
  | 'kit_shipped'
  | 'kit_delivered'
  | 'sample_mailed'
  | 'sample_received'
  | 'qc_passed'
  | 'qc_failed'
  | 'sequencing_complete'
  | 'report_ready'
  | 'kit_replaced';

export interface Order {
  orderId: string;
  createdAt: string;
  timestamp: number;
  customerId: string;
  product: string;
  country: string;
  status: string;
  isTest: boolean;
}

export interface KitEvent {
  eventId: string;
  orderId: string;
  kitId: string;
  type: EventType;
  occurredAt: string;
  timestamp: number;
  source: string;
}

export interface ImportDiagnostics {
  ordersRead: number;
  eventsRead: number;
  validOrders: number;
  validEvents: number;
  invalidOrders: number;
  invalidEvents: number;
  duplicateOrders: number;
  duplicateEvents: number;
  orphanEvents: number;
  naiveTimestamps: number;
  excludedOrders: { test: number; status: number; uploadOnly: number };
  warnings: string[];
}

export interface Dataset {
  orders: Order[];
  events: KitEvent[];
  diagnostics: ImportDiagnostics;
}

export interface Filters {
  asOf: string;
  startDate?: string;
  endDate?: string;
  product?: string;
  country?: string;
  search?: string;
}

export interface KitHistory {
  kitId: string;
  active: boolean;
  replaced: boolean;
  events: KitEvent[];
}

export interface OrderRow {
  orderId: string;
  createdAt: string;
  customerId: string;
  product: string;
  country: string;
  kitId: string | null;
  stage: StageId;
  stageLabel: string;
  stageEnteredAt: string;
  elapsedDays: number;
  targetDays: number | null;
  overdueDays: number;
  needsAttention: boolean;
  attentionReason: string | null;
  completed: boolean;
  kitCount: number;
  kits: KitHistory[];
  events: KitEvent[];
}

export interface DurationStats {
  medianDays: number | null;
  p90Days: number | null;
  count: number;
}

export interface StageDuration {
  stage: PipelineStage;
  label: string;
  targetDays: number;
  overall: DurationStats;
  byProduct: (DurationStats & { product: string })[];
}

export interface Snapshot {
  asOf: string;
  rows: OrderRow[];
  attention: OrderRow[];
  summary: {
    totalOrders: number;
    activeOrders: number;
    completedOrders: number;
    attentionOrders: number;
    completionRate: number;
  };
  stageCounts: { stage: StageId; label: string; count: number }[];
  durations: StageDuration[];
  options: { products: string[]; countries: string[] };
  diagnostics: ImportDiagnostics;
}

const DAY = 86_400_000;

function isEligible(order: Order): boolean {
  return (
    order.status === 'paid' && !order.isTest && order.product !== 'upload_only'
  );
}

function compareEvents(a: KitEvent, b: KitEvent): number {
  return a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId);
}

function kitHistories(events: KitEvent[]): KitHistory[] {
  const byKit = new Map<string, KitEvent[]>();
  for (const event of events) {
    const kit = byKit.get(event.kitId) ?? [];
    kit.push(event);
    byKit.set(event.kitId, kit);
  }
  return [...byKit]
    .map(([kitId, kitEvents]) => ({
      kitId,
      events: kitEvents,
      active: false,
      replaced: kitEvents.some((event) => event.type === 'kit_replaced'),
    }))
    .sort(
      (a, b) =>
        a.events[0].timestamp - b.events[0].timestamp ||
        a.kitId.localeCompare(b.kitId),
    );
}

function latest(events: KitEvent[], types: EventType[]): KitEvent | undefined {
  return events.filter((event) => types.includes(event.type)).at(-1);
}

function makeRow(order: Order, events: KitEvent[], asOf: number): OrderRow {
  const kits = kitHistories(events);
  const replacement = latest(events, ['kit_replaced']);
  const activeKit = kits
    .filter(
      (kit) =>
        !kit.replaced &&
        (!replacement || kit.events[0].timestamp >= replacement.timestamp),
    )
    .at(-1);
  if (activeKit) activeKit.active = true;
  const report = activeKit
    ? latest(activeKit.events, ['report_ready'])
    : undefined;

  let stage: StageId = 'awaiting_shipment';
  let enteredAt = replacement?.timestamp ?? order.timestamp;
  if (report) {
    stage = 'completed';
    enteredAt = report.timestamp;
  } else if (activeKit) {
    const observations: [EventType[], StageId][] = [
      [['sequencing_complete'], 'reporting'],
      [['qc_passed', 'qc_failed'], 'sequencing'],
      [['sample_received'], 'qc'],
      [['sample_mailed'], 'returning'],
      [['kit_delivered'], 'with_customer'],
      [['kit_shipped'], 'in_transit'],
    ];
    for (const [types, nextStage] of observations) {
      const event = latest(activeKit.events, types);
      if (!event) continue;
      stage = event.type === 'qc_failed' ? 'qc_failed' : nextStage;
      enteredAt = event.timestamp;
      break;
    }
  }
  const definition = STAGES.find((item) => item.id === stage);
  const completed = stage === 'completed';
  const stageLabel = completed
    ? 'Report ready'
    : stage === 'qc_failed'
      ? 'QC failed'
      : stage === 'awaiting_shipment' && replacement && !activeKit
        ? 'Awaiting replacement shipment'
        : definition!.label;
  const elapsedDays = Math.max(0, (asOf - enteredAt) / DAY);
  const targetDays = definition?.targetDays ?? null;
  const overdueDays =
    targetDays === null || completed
      ? 0
      : Math.max(0, elapsedDays - targetDays);
  const needsAttention = stage === 'qc_failed' || overdueDays > 0;
  return {
    orderId: order.orderId,
    createdAt: order.createdAt,
    customerId: order.customerId,
    product: order.product,
    country: order.country,
    kitId: activeKit?.kitId ?? null,
    stage,
    stageLabel,
    stageEnteredAt: new Date(enteredAt).toISOString(),
    elapsedDays,
    targetDays,
    overdueDays,
    needsAttention,
    attentionReason:
      stage === 'qc_failed'
        ? 'QC failed · arrange replacement'
        : overdueDays > 0
          ? `${stageLabel} exceeds the ${targetDays}-day target`
          : null,
    completed,
    kitCount: kits.length,
    kits,
    events,
  };
}

function stats(values: number[]): DurationStats {
  if (!values.length) return { medianDays: null, p90Days: null, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    medianDays:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    p90Days: sorted[Math.ceil(sorted.length * 0.9) - 1],
    count: sorted.length,
  };
}

function stageDurations(rows: OrderRow[], products: string[]): StageDuration[] {
  const samples = new Map<PipelineStage, { product: string; days: number }[]>(
    STAGES.map((stage) => [stage.id, []]),
  );
  for (const row of rows) {
    for (const [index, kit] of row.kits.entries()) {
      const replacementAt =
        kit.events.find((event) => event.type === 'kit_replaced')?.timestamp ??
        Infinity;
      const events = kit.events.filter(
        (event) =>
          event.type !== 'kit_replaced' && event.timestamp <= replacementAt,
      );
      const first = events[0]?.timestamp;
      const predecessor =
        first === undefined
          ? undefined
          : row.events
              .filter(
                (event) =>
                  event.type === 'kit_replaced' &&
                  event.kitId !== kit.kitId &&
                  event.timestamp <= first,
              )
              .at(-1);
      const shippingStart =
        predecessor?.timestamp ??
        (index === 0 ? Date.parse(row.createdAt) : undefined);
      for (const stage of STAGES) {
        let start: number | undefined;
        let endTypes: EventType[];
        switch (stage.id) {
          case 'awaiting_shipment':
            start = shippingStart;
            endTypes = ['kit_shipped'];
            break;
          case 'in_transit':
            start = events.find(
              (event) => event.type === 'kit_shipped',
            )?.timestamp;
            endTypes = ['kit_delivered'];
            break;
          case 'with_customer':
            start = events.find(
              (event) => event.type === 'kit_delivered',
            )?.timestamp;
            endTypes = ['sample_mailed'];
            break;
          case 'returning':
            start = events.find(
              (event) => event.type === 'sample_mailed',
            )?.timestamp;
            endTypes = ['sample_received'];
            break;
          case 'qc':
            start = events.find(
              (event) => event.type === 'sample_received',
            )?.timestamp;
            endTypes = ['qc_passed', 'qc_failed'];
            break;
          case 'sequencing':
            start = events.find(
              (event) => event.type === 'qc_passed',
            )?.timestamp;
            endTypes = ['sequencing_complete'];
            break;
          case 'reporting':
            start = events.find(
              (event) => event.type === 'sequencing_complete',
            )?.timestamp;
            endTypes = ['report_ready'];
            break;
        }
        if (start === undefined) continue;
        const end = events.find(
          (event) => endTypes.includes(event.type) && event.timestamp >= start,
        );
        if (end)
          samples
            .get(stage.id)!
            .push({
              product: row.product,
              days: (end.timestamp - start) / DAY,
            });
      }
    }
  }
  return STAGES.map((stage) => {
    const observations = samples.get(stage.id)!;
    return {
      stage: stage.id,
      label: stage.durationLabel,
      targetDays: stage.targetDays,
      overall: stats(observations.map((sample) => sample.days)),
      byProduct: products.map((product) => ({
        product,
        ...stats(
          observations
            .filter((sample) => sample.product === product)
            .map((sample) => sample.days),
        ),
      })),
    };
  });
}

export function buildSnapshot(dataset: Dataset, filters: Filters): Snapshot {
  const asOf = Date.parse(filters.asOf || DEFAULT_AS_OF);
  if (!Number.isFinite(asOf)) throw new Error('Choose a valid as-of date.');
  const eligible = dataset.orders.filter(isEligible);
  const products = [...new Set(eligible.map((order) => order.product))].sort();
  const countries = [...new Set(eligible.map((order) => order.country))].sort();
  const eventIndex = new Map<string, KitEvent[]>();
  for (const event of dataset.events) {
    if (event.timestamp > asOf) continue;
    const events = eventIndex.get(event.orderId) ?? [];
    events.push(event);
    eventIndex.set(event.orderId, events);
  }
  for (const events of eventIndex.values()) events.sort(compareEvents);
  const search = filters.search?.trim().toLowerCase() ?? '';
  const rows = eligible
    .filter((order) => {
      const day = order.createdAt.slice(0, 10);
      return (
        order.timestamp <= asOf &&
        (!filters.startDate || day >= filters.startDate) &&
        (!filters.endDate || day <= filters.endDate) &&
        (!filters.product ||
          filters.product === 'all' ||
          order.product === filters.product) &&
        (!filters.country ||
          filters.country === 'all' ||
          order.country === filters.country)
      );
    })
    .map((order) => makeRow(order, eventIndex.get(order.orderId) ?? [], asOf))
    .filter(
      (row) =>
        !search ||
        [row.orderId, row.customerId, ...row.kits.map((kit) => kit.kitId)].some(
          (value) => value.toLowerCase().includes(search),
        ),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) ||
        a.orderId.localeCompare(b.orderId),
    );
  const attention = rows
    .filter((row) => row.needsAttention)
    .sort(
      (a, b) =>
        Number(b.stage === 'qc_failed') - Number(a.stage === 'qc_failed') ||
        b.overdueDays - a.overdueDays ||
        b.elapsedDays - a.elapsedDays ||
        a.orderId.localeCompare(b.orderId),
    );
  const completedOrders = rows.filter((row) => row.completed).length;
  const allStages: { stage: StageId; label: string }[] = [
    ...STAGES.map((stage) => ({ stage: stage.id, label: stage.label })),
    { stage: 'qc_failed', label: 'QC failed' },
    { stage: 'completed', label: 'Report ready' },
  ];
  return {
    asOf: new Date(asOf).toISOString(),
    rows,
    attention,
    summary: {
      totalOrders: rows.length,
      activeOrders: rows.length - completedOrders,
      completedOrders,
      attentionOrders: attention.length,
      completionRate: rows.length ? (completedOrders / rows.length) * 100 : 0,
    },
    stageCounts: allStages.map((stage) => ({
      ...stage,
      count: rows.filter((row) => row.stage === stage.stage).length,
    })),
    durations: stageDurations(rows, products),
    options: { products, countries },
    diagnostics: dataset.diagnostics,
  };
}
