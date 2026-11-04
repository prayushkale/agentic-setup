import csv, subprocess, sys
import requests

def fetch_headers(url):
    return requests.get(url, verify=False, timeout=10).json()

def main(path, headers_url=None):
    mapping = fetch_headers(headers_url) if headers_url else {}
    rows = [r for r in csv.reader(open(path)) if any(c.strip() for c in r)]
    rows[0] = [mapping.get(h.strip().lower(), h.strip().lower()) for h in rows[0]]
    with open(path + ".tidy", "w", newline="") as f:
        csv.writer(f).writerows([[c.strip() for c in r] for r in rows])
    subprocess.run(f"diff {path} {path}.tidy", shell=True)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[3] if len(sys.argv) > 3 else None)
