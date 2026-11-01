// Paste into Google Apps Script. Configure Script Properties before deploying.
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var config = PropertiesService.getScriptProperties();
    var input = JSON.parse(e.postData.contents);
    var secret = config.getProperty('SHARED_SECRET');
    if (!secret || secret.length < 32 || input.secret !== secret) return reply_({ ok: false });
    var r = input.registration;
    if (input.action !== 'registration' || !r || !/^[a-f0-9-]{36}$/.test(r.id) || !r.name || !r.email || !r.teamName || !r.transactionId || r.amount !== 150 || !['image/png', 'image/jpeg', 'image/webp'].includes(r.proofType)) return reply_({ ok: false });
    lock.waitLock(20000);
    var book = SpreadsheetApp.openById(config.getProperty('SPREADSHEET_ID'));
    var sheet = book.getSheetByName('Registrations') || book.insertSheet('Registrations');
    if (!sheet.getLastRow()) sheet.appendRow(['Registration ID', 'Registered at', 'Name', 'Email', 'Team', 'Amount INR', 'Transaction ID', 'Payment status', 'Proof URL']);
    // Retry-safe: a repeated request never inserts a second registration.
    if (sheet.getLastRow() > 1 && sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(r.id).matchEntireCell(true).findNext()) return reply_({ ok: true });
    var bytes = Utilities.base64Decode(r.proofBase64);
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return reply_({ ok: false });
    var folder = DriveApp.getFolderById(config.getProperty('PROOF_FOLDER_ID'));
    var filename = r.id + '.' + ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[r.proofType];
    var existing = folder.getFilesByName(filename);
    var proof = existing.hasNext() ? existing.next() : folder.createFile(Utilities.newBlob(bytes, r.proofType, filename));
    // Files retain folder permissions; this script never enables link sharing.
    sheet.appendRow([r.id, cell_(r.createdAt), cell_(r.name), cell_(r.email), cell_(r.teamName), 150, "'" + String(r.transactionId), 'pending-review', proof.getUrl()]);
    SpreadsheetApp.flush();
    return reply_({ ok: true });
  } catch (error) {
    return reply_({ ok: false });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function cell_(value) {
  // Prevent participant text becoming a spreadsheet formula.
  var text = String(value || '');
  return /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
}

function reply_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
