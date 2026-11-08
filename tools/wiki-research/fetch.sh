cd "$(dirname "$0")/data"
python3 -I -c "import json;print('\n'.join(json.load(open('index.json'))))" | while read p; do
  [ -s "$p.html" ] && continue
  curl -sS -m 30 -o "$p.html" -w "$p %{http_code}\n" "https://backrooms-wiki.wikidot.com/$p" >> fetch.log 2>&1
  sleep 0.4
done
echo DONE >> fetch.log
