/** Bound to the existing BNN Receiving Issues - Daily Report Master spreadsheet. */
const RECEIVING_SYNC = Object.freeze({
  spreadsheetId: '1jEFGBIUa1tStDaJSuI3HPvri6NdAICGTag2LCBGQAfM',
  endpoint: 'https://gevivzvlfloaczpunymx.supabase.co/functions/v1/sheets-export',
  timezone: 'Asia/Bangkok',
  maxRows: 100000,
});

function receivingFetchAll_(kind, secret) {
  const all = [];
  let offset = 0;
  while (true) {
    const url = RECEIVING_SYNC.endpoint + '?kind=' + encodeURIComponent(kind) + '&offset=' + offset;
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'x-sheets-sync-secret': secret },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      throw new Error('Supabase export ' + kind + ' HTTP ' + response.getResponseCode());
    }
    const page = JSON.parse(response.getContentText());
    if (!Array.isArray(page.items)) throw new Error('Invalid export response');
    all.push(...page.items);
    if (all.length > RECEIVING_SYNC.maxRows) throw new Error('Export exceeds row limit');
    if (page.nextOffset === null) return all;
    if (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset)
      throw new Error('Invalid export pagination');
    offset = page.nextOffset;
  }
}

function receivingText_(value) {
  const text = value == null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function receivingDate_(iso) {
  return Utilities.formatDate(new Date(iso), RECEIVING_SYNC.timezone, 'yyyy-MM-dd');
}

function receivingTimestamp_(iso) {
  return Utilities.formatDate(new Date(iso), RECEIVING_SYNC.timezone, 'yyyy-MM-dd HH:mm:ss');
}

function receivingNumber_(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Invalid quantity in export');
  return n;
}

function receivingWrite_(spreadsheet, tab, headers, rows) {
  const sheet = spreadsheet.getSheetByName(tab);
  if (!sheet) throw new Error('Missing sheet ' + tab);
  const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (headers.some((heading, i) => actual[i] !== heading))
    throw new Error('Unexpected headers in ' + tab);
  if (sheet.getMaxRows() < rows.length + 1)
    sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  const existing = Math.max(sheet.getLastRow() - 1, 0);
  if (existing) sheet.getRange(2, 1, existing, headers.length).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function syncReceivingIssues() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another receiving sync is running');
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('SHEETS_SYNC_SECRET');
    if (!secret) throw new Error('SHEETS_SYNC_SECRET is missing from Script Properties');
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet || spreadsheet.getId() !== RECEIVING_SYNC.spreadsheetId)
      throw new Error('Unexpected spreadsheet');

    // Download all pages before changing the sheet. An API failure leaves the mirror intact.
    const issues = receivingFetchAll_('issues', secret);
    const dispatches = receivingFetchAll_('dispatches', secret);
    const groups = receivingFetchAll_('groups', secret);
    const quality = receivingFetchAll_('quality', secret);
    const media = receivingFetchAll_('media', secret);
    const groupById = new Map(groups.map(g => [g.group_id, g]));
    const groupName = id => receivingText_(groupById.get(id)?.group_name || id || 'ไม่ทราบกลุ่ม');
    const dispatchByDate = new Map(dispatches
      .filter(d => d.destination === 'teams-personal-chat')
      .map(d => [d.report_date, d.status]));
    const issueRows = [];
    const daily = new Map();
    const seen = new Set();
    for (const issue of issues) {
      if (seen.has(issue.id)) throw new Error('Duplicate issue ID in export');
      seen.add(issue.id);
      const delta = receivingNumber_(issue.delta_qty);
      const ordered = receivingNumber_(issue.ordered_qty);
      const received = receivingNumber_(issue.received_qty);
      if (Math.abs((received - ordered) - delta) > 0.001)
        throw new Error('Quantity mismatch in export');
      // Zero shortages permitted; overages up to and including 3% are accepted.
      // All exported receiving_issues must therefore exceed the allowed tolerance.
      if (delta === 0 || (delta > 0 && ordered > 0 &&
          Math.round(delta * 1000) * 100 <= Math.round(ordered * 1000) * 3))
        throw new Error('Accepted variance unexpectedly included in receiving issues export');
      const date = receivingDate_(issue.message_at);
      const branch = String(issue.branch);
      issueRows.push([
        issue.id, issue.issue_date, receivingTimestamp_(issue.message_at),
        receivingText_(branch), receivingText_(issue.product),
        issue.unit === 'kg' ? 'สินค้าชั่ง' : 'สินค้านับ',
        ordered, received, delta, Math.abs(delta), issue.unit,
        issue.variance_type, delta < 0 ?
          (issue.unit === 'kg' ? 'น้ำหนักชั่งขาด' : 'รับขาด') : 'รับเกินเกณฑ์ 3%',
        issue.status, 'LINE OA @842nltit', receivingText_(issue.line_message_id), receivingText_(issue.group_id||''), '',
      ]);
      const key = date + '\u0000' + branch;
      if (!daily.has(key)) daily.set(key, {
        date, branch, count: 0, short: 0, over: 0,
        shortKg: 0, overKg: 0, other: 0, weightShortCount: 0,
        pending: 0, products: [],
      });
      const group = daily.get(key);
      group.count++;
      if (delta < 0) group.short++; else group.over++;
      if (issue.unit === 'kg') {
        if (delta < 0) {
          group.shortKg += Math.abs(delta);
          group.weightShortCount++;
        }
        else group.overKg += delta;
      } else group.other++;
      if (issue.status === 'PENDING_REVIEW') group.pending++;
      if (group.products.length < 3) group.products.push(receivingText_(issue.product));
    }
    const dailyRows = [...daily.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch, 'th'))
      .map(g => [g.date, receivingText_(g.branch), g.count, g.short, g.over,
        g.shortKg, g.overKg, g.other, g.pending,
        (g.weightShortCount ? 'น้ำหนักชั่งขาด ' + g.weightShortCount + ' รายการ | ' : '') +
          g.products.join(', '),
        'รอตรวจสอบ', 'ตรวจใบส่งของและหลักฐานรับสินค้า',
        dispatchByDate.get(g.date) || 'ยังไม่ส่ง']);
    const reportRows = dispatches.map(d => [
      d.report_date, 'ทุกสาขา', d.destination,
      d.status === 'SENT' ? receivingTimestamp_(d.updated_at) : '',
      d.status, d.report_date + ':' + d.destination,
      receivingText_(d.error_code || ''),
    ]);

    receivingWrite_(spreadsheet, 'ISSUES', [
      'record_id','issue_date','received_at','branch','product','product_type',
      'ordered_qty','received_qty','difference','abs_difference','unit',
      'variance_type','issue_type','status','source','message_id','group_id','notes',
    ], issueRows);
    receivingWrite_(spreadsheet, 'BRANCH_DAILY', [
      'report_date','branch','issue_items','shortage_items','over_items',
      'shortage_kg','over_kg','other_items','pending_items','main_findings',
      'possible_cause','recommended_action','send_status',
    ], dailyRows);
    receivingWrite_(spreadsheet, 'REPORT_LOG', [
      'report_date','scope','destination','sent_at','status','idempotency_key','error_note',
    ], reportRows);
    // Quality reporting is independent of receiving's zero-shortage/3%-overage policy.
    const groupRows = groups.map(g => [
      receivingText_(g.group_id), receivingText_(g.group_name||''),
      g.route, g.route_source, receivingTimestamp_(g.last_seen_at),
      receivingTimestamp_(g.created_at),
    ]);
    const qualityRows = quality.map(q => [
      receivingText_(q.line_message_id), receivingText_(q.group_id),
      groupName(q.group_id), receivingTimestamp_(q.message_at),
      receivingText_(q.branch), receivingText_(q.product), receivingText_(q.supplier),
      receivingText_(q.lot), receivingText_(q.quantity_text), receivingText_(q.weight_text),
      receivingText_(q.defect), receivingText_(q.resolution), receivingText_(q.status),
      receivingText_(q.raw_text),
    ]);
    const qualityMedia = media.filter(m =>
      m.route === 'QUALITY' || groupById.get(m.group_id)?.route === 'QUALITY');
    const mediaRows = qualityMedia.map(m => [
      receivingText_(m.line_message_id), receivingText_(m.group_id),
      groupName(m.group_id), m.message_type, receivingTimestamp_(m.message_at),
      'บันทึกรหัสรูปภาพจาก LINE เท่านั้น — ยังไม่ได้ดาวน์โหลดไฟล์',
    ]);
    const dailyByGroup = new Map();
    function groupDaily_(date, id) {
      const key = date + '|' + (id || '');
      if (!dailyByGroup.has(key)) dailyByGroup.set(key, {
        date, id:id||'', receiving:0, quality:0, media:0,
      });
      return dailyByGroup.get(key);
    }
    for (const issue of issues) groupDaily_(receivingDate_(issue.message_at),issue.group_id).receiving++;
    for (const q of quality) groupDaily_(receivingDate_(q.message_at),q.group_id).quality++;
    for (const m of qualityMedia) groupDaily_(receivingDate_(m.message_at),m.group_id).media++;
    const groupDailyRows = [...dailyByGroup.values()]
      .sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map(g => [g.date, receivingText_(g.id), groupName(g.id),
        groupById.get(g.id)?.route || 'UNMAPPED',
        g.receiving, g.quality, g.media, 'รอตรวจสอบ']);

    receivingWrite_(spreadsheet, 'LINE_GROUPS',
      ['group_id','group_name','route','route_source','last_seen_at','created_at'], groupRows);
    receivingWrite_(spreadsheet, 'QUALITY_ISSUES',
      ['line_message_id','group_id','group_name','message_at','branch','product','supplier',
       'lot','quantity','weight','defect','resolution','status','raw_text'], qualityRows);
    receivingWrite_(spreadsheet, 'QUALITY_MEDIA',
      ['line_message_id','group_id','group_name','message_type','message_at','note'], mediaRows);
    receivingWrite_(spreadsheet, 'GROUP_DAILY',
      ['date','group_id','group_name','route','receiving_issues','quality_issues',
       'media_messages','status'], groupDailyRows);

    SpreadsheetApp.flush();
    console.log('LINE group mirror synced: issues='+issues.length+', quality='+quality.length+
      ', media='+qualityMedia.length+', groups='+groups.length+', reports='+dispatches.length);
    return {issues:issues.length,branchDays:dailyRows.length,quality:quality.length,
      media:qualityMedia.length,groups:groups.length,dispatches:dispatches.length};
  } finally {
    lock.releaseLock();
  }
}

function installReceivingSyncTrigger() {
  const existing = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncReceivingIssues');
  if (existing.length > 0) {
    console.log('Receiving sync trigger already installed; keeping existing trigger(s): ' + existing.length);
    return { action: 'existing', count: existing.length };
  }
  ScriptApp.newTrigger('syncReceivingIssues').timeBased().everyMinutes(15).create();
  console.log('Created one receiving sync trigger at 15-minute intervals');
  return { action: 'created', count: 1 };
}

/** Read-only check. Does not log or return secret values. */
function auditReceivingSyncSetup() {
  const triggers = ScriptApp.getProjectTriggers().filter(
    trigger => trigger.getHandlerFunction() === 'syncReceivingIssues');
  return {
    syncFunction: 'syncReceivingIssues',
    triggerCount: triggers.length,
    scriptSecretConfigured: Boolean(PropertiesService.getScriptProperties().getProperty('SHEETS_SYNC_SECRET')),
    spreadsheetIdMatches: Boolean(SpreadsheetApp.getActiveSpreadsheet() &&
      SpreadsheetApp.getActiveSpreadsheet().getId() === RECEIVING_SYNC.spreadsheetId),
  };
}