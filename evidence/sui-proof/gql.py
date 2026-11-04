import json, urllib.request, sys
URL = "https://graphql.mainnet.sui.io/graphql"
def q(query, variables=None):
    req = urllib.request.Request(URL, data=json.dumps({"query": query, "variables": variables or {}}).encode(),
                                 headers={"content-type": "application/json", "User-Agent": "receipts"})
    d = json.load(urllib.request.urlopen(req, timeout=30))
    if "errors" in d: raise RuntimeError(json.dumps(d["errors"])[:800])
    return d["data"]
if __name__ == "__main__":
    print(json.dumps(q(sys.argv[1]), indent=1)[:3000])
