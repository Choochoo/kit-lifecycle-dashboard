import Papa from 'papaparse';
import type {
  Dataset,
  EventType,
  ImportDiagnostics,
  KitEvent,
  Order,
} from './domain';

const ORDER_HEADERS = [
  'order_id',
  'created_at',
  'customer_id',
  'product',
  'country',
  'status',
  'is_test',
];
const EVENT_HEADERS = [
  'event_id',
  'order_id',
  'kit_id',
  'event_type',
  'occurred_at',
  'source',
];
const EVENT_TYPES = new Set<EventType>([
  'kit_shipped',
  'kit_delivered',
  'sample_mailed',
  'sample_received',
  'qc_passed',
  'qc_failed',
  'sequencing_complete',
  'report_ready',
  'kit_replaced',
]);

function readCsv(
  text: string,
  required: string[],
  name: string,
): Record<string, string>[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length)
    throw new Error(`${name}: malformed CSV (${parsed.errors[0].message}).`);
  const headers = parsed.data[0]?.map((header) => header.trim()) ?? [];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length)
    throw new Error(`${name}: missing columns: ${missing.join(', ')}.`);
  if (new Set(headers).size !== headers.length)
    throw new Error(`${name}: duplicate column names.`);
  return parsed.data.slice(1).map((row) => {
    if (row.length !== headers.length) return {};
    return Object.fromEntries(
      headers.map((header, index) => [header, row[index].trim()]),
    );
  });
}

// Interpret timestamps without an offset as UTC, independent of the browser's timezone.
function timestamp(value: string): { value: number; naive: boolean } | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      value,
    );
  if (!match) return null;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fraction = '',
    zone,
  ] = match;
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const utc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    Number(fraction.padEnd(3, '0').slice(0, 3)),
  );
  if (new Date(utc).getUTCMonth() !== month - 1) return null;
  let offset = 0;
  if (zone && zone.toUpperCase() !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2));
    if (hours > 23 || minutes > 59) return null;
    offset = (hours * 60 + minutes) * (zone[0] === '+' ? 1 : -1);
  }
  return { value: utc - offset * 60_000, naive: !zone };
}

export function parseDataset(ordersCsv: string, eventsCsv: string): Dataset {
  const orderRows = readCsv(ordersCsv, ORDER_HEADERS, 'Orders');
  const eventRows = readCsv(eventsCsv, EVENT_HEADERS, 'Kit events');
  const diagnostics: ImportDiagnostics = {
    ordersRead: orderRows.length,
    eventsRead: eventRows.length,
    validOrders: 0,
    validEvents: 0,
    invalidOrders: 0,
    invalidEvents: 0,
    duplicateOrders: 0,
    duplicateEvents: 0,
    orphanEvents: 0,
    naiveTimestamps: 0,
    excludedOrders: { test: 0, status: 0, uploadOnly: 0 },
    warnings: [],
  };
  const warnings = new Set<string>();
  const orders: Order[] = [];
  const orderById = new Map<string, Order>();
  for (const row of orderRows) {
    const at = timestamp(row.created_at ?? '');
    const test = row.is_test?.toLowerCase();
    if (
      !at ||
      !row.order_id ||
      !row.customer_id ||
      !/^[A-Za-z]{2}$/.test(row.country ?? '') ||
      !['wgs_30x', 'wgs_100x', 'upload_only'].includes(row.product) ||
      !['paid', 'refunded', 'cancelled'].includes(row.status) ||
      !['true', 'false', '1', '0'].includes(test)
    ) {
      diagnostics.invalidOrders++;
      continue;
    }
    if (at.naive) diagnostics.naiveTimestamps++;
    if (orderById.has(row.order_id)) {
      diagnostics.duplicateOrders++;
      warnings.add('Duplicate order IDs: the first valid row is retained.');
      continue;
    }
    const order: Order = {
      orderId: row.order_id,
      createdAt: new Date(at.value).toISOString(),
      timestamp: at.value,
      customerId: row.customer_id,
      product: row.product,
      country: row.country.toUpperCase(),
      status: row.status,
      isTest: test === 'true' || test === '1',
    };
    orders.push(order);
    orderById.set(order.orderId, order);
    // Exclusions are disjoint so their sum reconciles with the eligible order count.
    if (order.isTest) diagnostics.excludedOrders.test++;
    else if (order.status !== 'paid') diagnostics.excludedOrders.status++;
    else if (order.product === 'upload_only')
      diagnostics.excludedOrders.uploadOnly++;
  }

  const events: KitEvent[] = [];
  const semanticKeys = new Set<string>();
  const eventIds = new Map<string, string>();
  for (const row of eventRows) {
    const at = timestamp(row.occurred_at ?? '');
    if (
      !at ||
      !row.event_id ||
      !row.order_id ||
      !row.kit_id ||
      !EVENT_TYPES.has(row.event_type as EventType) ||
      !['carrier', 'lab', 'system'].includes(row.source)
    ) {
      diagnostics.invalidEvents++;
      continue;
    }
    if (at.naive) diagnostics.naiveTimestamps++;
    const order = orderById.get(row.order_id);
    if (!order) {
      diagnostics.orphanEvents++;
      continue;
    }
    if (at.value < order.timestamp) {
      diagnostics.invalidEvents++;
      warnings.add('Events before their order was created are excluded.');
      continue;
    }
    const key = JSON.stringify([
      row.order_id,
      row.kit_id,
      row.event_type,
      at.value,
    ]);
    if (semanticKeys.has(key)) {
      diagnostics.duplicateEvents++;
      continue;
    }
    if (eventIds.has(row.event_id)) {
      diagnostics.invalidEvents++;
      warnings.add('Conflicting event IDs: the first valid event is retained.');
      continue;
    }
    semanticKeys.add(key);
    eventIds.set(row.event_id, key);
    events.push({
      eventId: row.event_id,
      orderId: row.order_id,
      kitId: row.kit_id,
      type: row.event_type as EventType,
      timestamp: at.value,
      occurredAt: new Date(at.value).toISOString(),
      source: row.source,
    });
  }
  diagnostics.validOrders = orders.length;
  diagnostics.validEvents = events.length;
  diagnostics.warnings = [...warnings];
  if (orders.length === 0)
    throw new Error(
      'Orders: no valid orders were found. Check the column values and timestamps.',
    );
  return { orders, events, diagnostics };
}
