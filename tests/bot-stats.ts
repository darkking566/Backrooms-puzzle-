export function distribution(values: number[]) {
  const a = [...values].sort((a,b) => a-b), at = (p: number) => a[Math.min(a.length-1, Math.floor(a.length*p))] ?? null;
  return { n: a.length, mean: a.length ? a.reduce((s,n)=>s+n,0)/a.length : null, min: a[0] ?? null,
    p10: at(.1), p25: at(.25), median: a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : null, p75: at(.75), p90: at(.9), max: a.at(-1) ?? null };
}
