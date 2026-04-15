// NGC HomeIQ — Apps Script Backend v4
// Handles Amazon OAuth + Sonos OAuth + Alexa directives
// Deploy as Web App: Execute as Me, Anyone can access

const AMAZON_CLIENT_ID = 'AMAZON_CLIENT_ID_HERE';
const AMAZON_CLIENT_SECRET = 'AMAZON_CLIENT_SECRET_HERE';

const SONOS_CLIENT_ID = 'SONOS_CLIENT_ID_HERE';
const SONOS_CLIENT_KEY = 'SONOS_CLIENT_KEY_HERE';
const SONOS_CLIENT_SECRET = 'SONOS_CLIENT_SECRET_HERE';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    // Check for POST body (Alexa directives)
    if (e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      if (body.directive) {
        output.setContent(JSON.stringify(handleAlexaDirective(body)));
        return output;
      }
    }

    var params = e.parameter || {};
    var action = params.action || '';
    var result = {};

    // Amazon OAuth
    if (action === 'amazon_token') {
      result = exchangeAmazonCode(params.code, params.redirect_uri);
    } else if (action === 'amazon_refresh') {
      result = refreshAmazonToken(params.refresh_token);
    }
    // Sonos OAuth
    else if (action === 'sonos_token') {
      result = exchangeSonosCode(params.code, params.redirect_uri);
    } else if (action === 'sonos_refresh') {
      result = refreshSonosToken(params.refresh_token);
    }
    // Sonos API proxy calls
    else if (action === 'sonos_api') {
      result = sonosApiCall(params.token, params.method || 'GET', params.path, params.body);
    }
    // Alexa
    else if (action === 'alexa_devices') {
      result = getAlexaDevices(params.token);
    } else if (action === 'alexa_command') {
      result = sendAlexaCommand(params.token, params.endpoint_id, params.namespace, params.name, params.payload ? JSON.parse(params.payload) : {});
    }
    // Ping
    else if (action === 'ping') {
      result = { status: 'ok', message: 'NGC HomeIQ Apps Script v4 — Amazon + Sonos' };
    } else {
      result = { error: 'Unknown action: ' + action };
    }

    output.setContent(JSON.stringify(result));
  } catch(err) {
    output.setContent(JSON.stringify({ error: err.toString() }));
  }

  return output;
}

// ══════════════════════════════════════
// SONOS OAuth
// ══════════════════════════════════════

function exchangeSonosCode(code, redirectUri) {
  if (!code) return { error: 'Missing authorization code' };
  if (!redirectUri) return { error: 'Missing redirect_uri' };

  var authHeader = Utilities.base64Encode(SONOS_CLIENT_ID + ':' + SONOS_CLIENT_SECRET);

  var options = {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + authHeader
    },
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=authorization_code&code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent(redirectUri),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://api.sonos.com/login/v3/oauth/access', options);
  var data = JSON.parse(response.getContentText());

  if (data.error) {
    return { error: data.error, description: data.error_description || '' };
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    token_type: data.token_type
  };
}

function refreshSonosToken(refreshToken) {
  if (!refreshToken) return { error: 'Missing refresh_token' };

  var authHeader = Utilities.base64Encode(SONOS_CLIENT_ID + ':' + SONOS_CLIENT_SECRET);

  var options = {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + authHeader
    },
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://api.sonos.com/login/v3/oauth/access', options);
  var data = JSON.parse(response.getContentText());

  if (data.error) return { error: data.error };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in
  };
}

// ══════════════════════════════════════
// SONOS API Proxy
// ══════════════════════════════════════

function sonosApiCall(token, method, path, body) {
  if (!token) return { error: 'Missing Sonos token' };
  if (!path) return { error: 'Missing API path' };

  var url = 'https://api.ws.sonos.com/control/api/v1' + path;

  var options = {
    method: method || 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  if (body && method !== 'GET') {
    options.payload = body;
  }

  var response = UrlFetchApp.fetch(url, options);
  var statusCode = response.getResponseCode();
  var responseText = response.getContentText();

  try {
    return { status: statusCode, data: JSON.parse(responseText) };
  } catch(e) {
    return { status: statusCode, data: responseText };
  }
}

// ══════════════════════════════════════
// AMAZON OAuth
// ══════════════════════════════════════

function exchangeAmazonCode(code, redirectUri) {
  if (!code) return { error: 'Missing authorization code' };
  if (!redirectUri) return { error: 'Missing redirect_uri' };
  var payload = {
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: redirectUri,
    client_id: AMAZON_CLIENT_ID,
    client_secret: AMAZON_CLIENT_SECRET
  };
  var options = {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: Object.keys(payload).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]); }).join('&'),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch('https://api.amazon.com/auth/o2/token', options);
  var data = JSON.parse(response.getContentText());
  if (data.error) return { error: data.error, description: data.error_description };
  var profile = {};
  try {
    var profileRes = UrlFetchApp.fetch('https://api.amazon.com/user/profile', {
      headers: { 'Authorization': 'Bearer ' + data.access_token },
      muteHttpExceptions: true
    });
    profile = JSON.parse(profileRes.getContentText());
  } catch(e) {}
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    profile: { name: profile.name || '', email: profile.email || '', user_id: profile.user_id || '' }
  };
}

function refreshAmazonToken(refreshToken) {
  if (!refreshToken) return { error: 'Missing refresh_token' };
  var payload = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: AMAZON_CLIENT_ID,
    client_secret: AMAZON_CLIENT_SECRET
  };
  var options = {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: Object.keys(payload).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]); }).join('&'),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch('https://api.amazon.com/auth/o2/token', options);
  var data = JSON.parse(response.getContentText());
  if (data.error) return { error: data.error };
  return { access_token: data.access_token, expires_in: data.expires_in };
}

// ══════════════════════════════════════
// ALEXA
// ══════════════════════════════════════

function getAlexaDevices(token) {
  if (!token) return { error: 'Missing token' };
  try {
    var res = UrlFetchApp.fetch('https://api.amazonalexa.com/v2/endpoints?owner=~caller&expand=all&maxResults=50', {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var statusCode = res.getResponseCode();
    if (statusCode === 401 || statusCode === 403) {
      return { error: 'Token lacks device access. Complete Alexa skill account linking first.', status: statusCode };
    }
    return JSON.parse(res.getContentText());
  } catch(e) {
    return { error: e.toString() };
  }
}

function sendAlexaCommand(token, endpointId, namespace, name, payload) {
  if (!token) return { error: 'Missing token' };
  if (!endpointId) return { error: 'Missing endpoint_id' };
  try {
    var body = {
      directive: {
        header: { namespace: namespace, name: name, payloadVersion: '3', messageId: Utilities.getUuid() },
        endpoint: { endpointId: endpointId, scope: { type: 'BearerToken', token: token } },
        payload: payload || {}
      }
    };
    var res = UrlFetchApp.fetch('https://api.amazonalexa.com/v3/events', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    return { status: res.getResponseCode(), body: res.getContentText() };
  } catch(e) {
    return { error: e.toString() };
  }
}

// ══════════════════════════════════════
// ALEXA DIRECTIVE HANDLER (for Lambda forwarding)
// ══════════════════════════════════════

function handleAlexaDirective(body) {
  var namespace = body.directive.header.namespace;
  var name = body.directive.header.name;

  if (namespace === 'Alexa.Discovery' && name === 'Discover') {
    return {
      event: {
        header: { namespace: 'Alexa.Discovery', name: 'Discover.Response', payloadVersion: '3', messageId: Utilities.getUuid() },
        payload: { endpoints: [] }
      }
    };
  }

  return { error: 'Unsupported: ' + namespace + '.' + name };
}
