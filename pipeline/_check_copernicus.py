"""
Direct Copernicus Marine credential test — bypasses the copernicusmarine toolbox,
which mislabels a 400 "wrong password" as "Could not connect to authentication
system".

Run in YOUR terminal (the password is only sent to Copernicus, not printed):

    .venv\\Scripts\\python pipeline\\_check_copernicus.py
"""

import getpass
import json
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URL = "https://auth.marine.copernicus.eu/realms/MIS/protocol/openid-connect/token"

username = input("Copernicus username (or email): ").strip()
password = getpass.getpass("Copernicus password: ")

data = urllib.parse.urlencode(
    {
        "client_id": "toolbox",
        "grant_type": "password",
        "username": username,
        "password": password,
        "scope": "openid profile email",
    }
).encode()

req = urllib.request.Request(
    TOKEN_URL, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}
)

try:
    resp = urllib.request.urlopen(req, timeout=30)
    tok = json.loads(resp.read())
    print("\n✅ CREDENTIALS VALID — got an access token.")
    print("   The toolbox failure is its own bug; we can work around it.")
except urllib.error.HTTPError as e:
    body = json.loads(e.read().decode(errors="replace") or "{}")
    err = body.get("error", "?")
    desc = body.get("error_description", "")
    print(f"\n❌ HTTP {e.code}  {err}: {desc}")
    if err == "invalid_grant":
        print("   -> Username or password is wrong, OR the account email isn't verified.")
        print("      Try logging in at https://data.marine.copernicus.eu/ in a browser.")
    elif err == "invalid_client":
        print("   -> The toolbox's client id was rejected — Copernicus changed something.")
    else:
        print("   -> Unexpected. Note the error above.")
except Exception as e:
    print(f"\n⚠️  Real connection failure: {type(e).__name__}: {e}")
