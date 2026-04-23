/**
 * 🏸 Shuttle — Google Apps Script Backend
 *
 * ใช้ Google Sheets เป็น database
 * Deploy เป็น Web App แล้วเรียกจาก frontend ได้เลย
 *
 * Setup:
 * 1. สร้าง Google Sheet มี 2 tabs: "players" และ "matches"
 * 2. players: id | name | lineUserId | pictureUrl | createdAt
 * 3. matches: id | player1 | player2 | player3 | player4 | winner1 | winner2 | loser1 | loser2 | reportedBy | createdAt
 * 4. ใส่ LINE_CHANNEL_ID และ LINE_CHANNEL_SECRET ด้านล่าง
 * 5. วางโค้ดนี้ใน Apps Script → Deploy → Web App → Anyone
 */

// =============================================
// CONFIG — แก้ 2 ค่านี้
// =============================================
const LINE_CHANNEL_ID     = '2009832825';
const LINE_CHANNEL_SECRET = '22a261982200000ec0bd2708b4746f26';
const SPREADSHEET_ID      = '1e3ifM6Esywl4Uzdw0ipbrD_q2h5ozUIhV4Yzj8b7WkQ';

function getSpreadsheet() {
  return SPREADSHEET_ID === 'YOUR_SPREADSHEET_ID'
    ? SpreadsheetApp.getActiveSpreadsheet()
    : SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  return getSpreadsheet().getSheetByName(name);
}

// =============================================
// CORS + ROUTING
// =============================================

// Handle GET requests
function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    switch (action) {
      case 'getPlayers':
        result = getPlayers();
        break;
      case 'getMatches':
        result = getMatches();
        break;
      case 'getRankings':
        result = getRankings();
        break;
      case 'getAllScores':
        result = getAllScores();
        break;
      case 'getWeeklyRankings':
        result = getWeeklyRankings();
        break;
      case 'getAllData':
        result = getAllData();
        break;
      case 'getDailyRankings':
        result = getDailyRankings();
        break;
      case 'getMonthlyRankings':
        result = getMonthlyRankings();
        break;
      case 'getMonthlyWinners':
        result = getMonthlyWinners();
        break;
      case 'getPlayerByLine':
        result = getPlayerByLineId(e.parameter.lineUserId);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Handle POST requests
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'Invalid JSON' });
  }

  const action = body.action;
  let result;

  try {
    switch (action) {
      case 'registerPlayer':
        result = registerPlayer(body);
        break;
      case 'lineLogin':
        result = lineLogin(body);
        break;
      case 'recordResult':
        result = recordResult(body);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return jsonResponse(result);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================
// LINE LOGIN — token exchange (browser can't do this due to CORS)
// =============================================

/**
 * รับ code จาก frontend → แลก token กับ LINE → return player profile
 * body: { code, codeVerifier, redirectUri }
 */
function lineLogin(data) {
  const { code, redirectUri } = data;
  if (!code || !redirectUri) {
    return { error: 'code and redirectUri required' };
  }

  // Exchange authorization code for access token
  const tokenRes = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'post',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    payload: [
      'grant_type=authorization_code',
      'code='          + encodeURIComponent(code),
      'redirect_uri='  + encodeURIComponent(redirectUri),
      'client_id='     + encodeURIComponent(LINE_CHANNEL_ID),
      'client_secret=' + encodeURIComponent(LINE_CHANNEL_SECRET),
    ].join('&'),
    muteHttpExceptions: true,
  });

  const tokenData = JSON.parse(tokenRes.getContentText());
  if (!tokenData.access_token) {
    return { error: 'Token exchange failed', detail: tokenData };
  }

  // Fetch LINE profile
  const profileRes = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    headers: { 'Authorization': 'Bearer ' + tokenData.access_token },
    muteHttpExceptions: true,
  });
  const profile = JSON.parse(profileRes.getContentText());

  if (!profile.userId) {
    return { error: 'Failed to fetch LINE profile', detail: profile };
  }

  // Auto-register player
  return registerPlayer({
    name: profile.displayName,
    lineUserId: profile.userId,
    pictureUrl: profile.pictureUrl || '',
  });
}

// =============================================
// PLAYER FUNCTIONS
// =============================================

/**
 * สมัครสมาชิกใหม่ (ใช้ข้อมูลจาก LINE Profile)
 * ถ้า lineUserId ซ้ำ → return player เดิม (ไม่สร้างใหม่)
 */
function registerPlayer(data) {
  const { name, lineUserId, pictureUrl } = data;

  if (!name || !lineUserId) {
    return { error: 'name and lineUserId are required' };
  }

  // เช็คว่ามีอยู่แล้วหรือยัง
  const existing = getPlayerByLineId(lineUserId);
  if (existing) {
    return { success: true, player: existing, isNew: false };
  }

  const sheet = getSheet('players');
  const id = generateId();
  const createdAt = new Date().toISOString();

  sheet.appendRow([id, name, lineUserId, pictureUrl || '', createdAt]);

  const player = { id, name, lineUserId, pictureUrl: pictureUrl || '', createdAt };
  return { success: true, player, isNew: true };
}

/**
 * ดึง player จาก LINE User ID
 */
function getPlayerByLineId(lineUserId) {
  if (!lineUserId) return null;

  const sheet = getSheet('players');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === lineUserId) {
      return {
        id: data[i][0],
        name: data[i][1],
        lineUserId: data[i][2],
        pictureUrl: data[i][3],
        createdAt: data[i][4]
      };
    }
  }
  return null;
}

/**
 * ดึง players ทั้งหมด
 */
function getPlayers() {
  const sheet = getSheet('players');
  const data = sheet.getDataRange().getValues();
  const players = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue; // skip empty rows
    players.push({
      id: data[i][0],
      name: data[i][1],
      lineUserId: data[i][2],
      pictureUrl: data[i][3],
      createdAt: data[i][4]
    });
  }

  return { players };
}

// =============================================
// MATCH FUNCTIONS
// =============================================

/**
 * บันทึกผลแมตช์
 * Trust-based: ใครก็บันทึกได้ ส่ง lineUserId มาเพื่อบอกว่าใครเป็นคนบันทึก
 * 
 * body: {
 *   winners: [playerId, playerId],   // 2 คนที่ชนะ
 *   losers: [playerId, playerId],    // 2 คนที่แพ้
 *   reportedBy: lineUserId           // คนที่บันทึก
 * }
 */
function submitMatch(data) {
  const { winners, losers, reportedBy } = data;

  if (!winners || winners.length !== 2 || !losers || losers.length !== 2) {
    return { error: 'Need exactly 2 winners and 2 losers' };
  }

  // เช็คว่าไม่มีคนซ้ำ
  const allPlayers = [...winners, ...losers];
  if (new Set(allPlayers).size !== 4) {
    return { error: 'Duplicate players detected' };
  }

  const sheet = getSheet('matches');
  const id = generateId();
  const createdAt = new Date().toISOString();

  // เก็บ: id | player1-4 (ทุกคน) | winner1-2 | loser1-2 | reportedBy | createdAt
  sheet.appendRow([
    id,
    allPlayers[0], allPlayers[1], allPlayers[2], allPlayers[3],
    winners[0], winners[1],
    losers[0], losers[1],
    reportedBy || '',
    createdAt
  ]);

  return { success: true, matchId: id };
}

/**
 * ดึงแมตช์ทั้งหมด (ล่าสุดก่อน)
 */
function getMatches() {
  const sheet = getSheet('matches');
  const data = sheet.getDataRange().getValues();
  const matches = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    matches.push({
      id: data[i][0],
      players: [data[i][1], data[i][2], data[i][3], data[i][4]],
      winners: [data[i][5], data[i][6]],
      losers: [data[i][7], data[i][8]],
      reportedBy: data[i][9],
      createdAt: data[i][10]
    });
  }

  // ล่าสุดก่อน
  matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { matches };
}

/**
 * ลบแมตช์ (เฉพาะคนที่บันทึกเท่านั้น)
 */
function deleteMatch(matchId, lineUserId) {
  if (!matchId) return { error: 'matchId required' };

  const sheet = getSheet('matches');
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === matchId) {
      // เช็คว่าคนลบเป็นคนที่บันทึกหรือเปล่า
      const reporter = data[i][9];
      const reporterPlayer = getPlayerByLineId(lineUserId);

      if (reporter && reporterPlayer && reporter !== lineUserId && reporter !== reporterPlayer.id) {
        return { error: 'Only the reporter can delete this match' };
      }

      sheet.deleteRow(i + 1); // +1 because sheets are 1-indexed
      return { success: true };
    }
  }

  return { error: 'Match not found' };
}

// =============================================
// RECORD RESULT (QR scan)
// =============================================

/**
 * บันทึกผลจาก QR scan
 * body: { playerId, result: 'win'|'lose', points: 3|1 }
 */
function recordResult(data) {
  const { playerId, result, points } = data;
  if (!playerId || !result) return { error: 'playerId and result required' };

  const sheet = getSheet('scores');
  if (!sheet) return { error: 'scores sheet not found — please create a tab named "scores"' };

  const id = generateId();
  const createdAt = new Date().toISOString();
  // id | playerId | result | points | createdAt
  sheet.appendRow([id, playerId, result, points, createdAt]);

  return { success: true, id };
}

// =============================================
// RANKING FUNCTIONS
// =============================================

/**
 * คำนวณ ranking จาก scores sheet: Win = 3 pts, Loss = 1 pt
 */
function getRankings() {
  const { players } = getPlayers();

  const scoresSheet = getSheet('scores');
  const scoresData = scoresSheet ? scoresSheet.getDataRange().getValues() : [];

  const stats = {};
  players.forEach(p => {
    stats[p.id] = { id: p.id, name: p.name, pictureUrl: p.pictureUrl, played: 0, wins: 0, losses: 0, points: 0 };
  });

  for (let i = 1; i < scoresData.length; i++) {
    const row = scoresData[i];
    if (!row[0]) continue;
    const pid    = row[1];
    const result = row[2];
    const pts    = Number(row[3]);
    if (stats[pid]) {
      stats[pid].played++;
      if (result === 'win') stats[pid].wins++;
      else stats[pid].losses++;
      stats[pid].points += pts;
    }
  }

  const rankings = Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name);
  });

  return { rankings };
}

/**
 * คำนวณ ranking เฉพาะอาทิตย์นี้ (จันทร์ - อาทิตย์)
 */
function getWeeklyRankings() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);

  const { players } = getPlayers();
  const scoresSheet = getSheet('scores');
  const scoresData  = scoresSheet ? scoresSheet.getDataRange().getValues() : [];

  const stats = {};
  players.forEach(p => {
    stats[p.id] = { id: p.id, name: p.name, pictureUrl: p.pictureUrl, played: 0, wins: 0, losses: 0, points: 0 };
  });

  for (let i = 1; i < scoresData.length; i++) {
    const row = scoresData[i];
    if (!row[0]) continue;
    const createdAt = new Date(row[4]);
    if (createdAt < monday) continue; // กรองเฉพาะอาทิตย์นี้
    const pid = row[1], result = row[2], pts = Number(row[3]);
    if (stats[pid]) {
      stats[pid].played++;
      if (result === 'win') stats[pid].wins++;
      else stats[pid].losses++;
      stats[pid].points += pts;
    }
  }

  const rankings = Object.values(stats)
    .filter(p => p.played > 0)
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));

  return { rankings };
}

// =============================================
// ALL DATA (รวม 3 calls เป็น 1)
// =============================================

/**
 * คำนวณ ranking เฉพาะวันนี้
 */
function getDailyRankings() {
  const now       = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const { players } = getPlayers();
  const scoresSheet = getSheet('scores');
  const scoresData  = scoresSheet ? scoresSheet.getDataRange().getValues() : [];

  const stats = {};
  players.forEach(p => {
    stats[p.id] = { id: p.id, name: p.name, pictureUrl: p.pictureUrl, played: 0, wins: 0, losses: 0, points: 0 };
  });

  for (let i = 1; i < scoresData.length; i++) {
    const row = scoresData[i];
    if (!row[0]) continue;
    const t = new Date(row[4]);
    if (t < todayStart || t >= todayEnd) continue;
    const pid = row[1], result = row[2], pts = Number(row[3]);
    if (stats[pid]) {
      stats[pid].played++;
      if (result === 'win') stats[pid].wins++;
      else stats[pid].losses++;
      stats[pid].points += pts;
    }
  }

  return {
    rankings: Object.values(stats)
      .filter(p => p.played > 0)
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name))
  };
}

/**
 * คำนวณ ranking เดือนนี้
 */
function getMonthlyRankings() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();

  const { players } = getPlayers();
  const scoresSheet = getSheet('scores');
  const scoresData  = scoresSheet ? scoresSheet.getDataRange().getValues() : [];

  const stats = {};
  players.forEach(p => {
    stats[p.id] = { id: p.id, name: p.name, pictureUrl: p.pictureUrl, played: 0, wins: 0, losses: 0, points: 0 };
  });

  for (let i = 1; i < scoresData.length; i++) {
    const row = scoresData[i];
    if (!row[0]) continue;
    const t = new Date(row[4]);
    if (t.getFullYear() !== year || t.getMonth() !== month) continue;
    const pid = row[1], result = row[2], pts = Number(row[3]);
    if (stats[pid]) {
      stats[pid].played++;
      if (result === 'win') stats[pid].wins++;
      else stats[pid].losses++;
      stats[pid].points += pts;
    }
  }

  return {
    rankings: Object.values(stats)
      .filter(p => p.played > 0)
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name))
  };
}

/**
 * หา winner ของแต่ละเดือนในปีนี้ (single pass — ไม่เรียก getMonthlyRankings 12 ครั้ง)
 */
function getMonthlyWinners() {
  const year = new Date().getFullYear();
  const { players } = getPlayers();
  const scoresSheet = getSheet('scores');
  const scoresData  = scoresSheet ? scoresSheet.getDataRange().getValues() : [];

  // สร้าง stats สำหรับทุกเดือนในครั้งเดียว
  const monthData = {};
  for (let m = 0; m < 12; m++) {
    monthData[m] = {};
    players.forEach(p => {
      monthData[m][p.id] = { id: p.id, name: p.name, pictureUrl: p.pictureUrl, points: 0, wins: 0 };
    });
  }

  for (let i = 1; i < scoresData.length; i++) {
    const row = scoresData[i];
    if (!row[0]) continue;
    const t = new Date(row[4]);
    if (t.getFullYear() !== year) continue;
    const m = t.getMonth(), pid = row[1], result = row[2], pts = Number(row[3]);
    if (monthData[m] && monthData[m][pid]) {
      monthData[m][pid].points += pts;
      if (result === 'win') monthData[m][pid].wins++;
    }
  }

  const winners = [];
  for (let m = 0; m < 12; m++) {
    const list = Object.values(monthData[m])
      .filter(p => p.points > 0)
      .sort((a, b) => b.points - a.points || b.wins - a.wins);
    winners.push({ month: m, year, winner: list[0] || null });
  }

  return { winners };
}

/**
 * ดึง scores ทั้งหมด (raw) สำหรับ migrate ไป Firebase
 */
function getAllScores() {
  const sheet = getSheet('scores');
  if (!sheet) return { scores: [] };
  const data = sheet.getDataRange().getValues();
  const scores = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    scores.push({
      id:        String(data[i][0]),
      playerId:  String(data[i][1]),
      result:    String(data[i][2]),
      points:    Number(data[i][3]),
      createdAt: data[i][4] ? new Date(data[i][4]).toISOString() : new Date().toISOString(),
    });
  }
  return { scores };
}

function getAllData() {
  var playersResult  = getPlayers();
  var rankingsResult = getRankings();
  var dailyResult    = getDailyRankings();
  var monthlyResult  = getMonthlyRankings();
  var winnersResult  = getMonthlyWinners();
  return {
    players:  playersResult.players,
    rankings: rankingsResult.rankings,
    daily:    dailyResult.rankings,
    monthly:  monthlyResult.rankings,
    winners:  winnersResult.winners,
  };
}

// =============================================
// UTILITIES
// =============================================

function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id + Date.now().toString(36).slice(-4);
}
