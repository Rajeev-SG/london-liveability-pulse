import { Fragment, startTransition, useEffect, useId, useRef, useState } from 'react';

import type { HistoryData, LatestData, LineageMetric, MetaData, Provenance } from './types.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; latest: LatestData; history: HistoryData; meta: MetaData };

type MetricKey = 'liveabilityScore' | 'transit' | 'wait' | 'weather' | 'air';

function formatUtc(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(iso));
}

function scoreTone(score: number): string {
  if (score >= 75) return 'good';
  if (score >= 50) return 'ok';
  if (score >= 30) return 'warn';
  return 'bad';
}

function freshnessInfo(collectedAtUtc: string): { label: 'Fresh' | 'Stale' | 'Outdated'; className: string; ageMinutes: number } {
  const ageMinutes = Math.max(0, (Date.now() - new Date(collectedAtUtc).getTime()) / 60000);
  if (ageMinutes <= 30) return { label: 'Fresh', className: 'fresh', ageMinutes };
  if (ageMinutes <= 120) return { label: 'Stale', className: 'stale', ageMinutes };
  return { label: 'Outdated', className: 'outdated', ageMinutes };
}

function buildSparkline(points: HistoryData['points'], width: number, height: number): string {
  if (points.length === 0) return '';
  const last24h = points.slice(-96);
  const max = 100;
  const min = 0;
  return last24h
    .map((point, index) => {
      const x = last24h.length === 1 ? width / 2 : (index / (last24h.length - 1)) * width;
      const y = height - ((point.score - min) / (max - min)) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function MetricLineagePopover({
  metricKey,
  label,
  lineage
}: {
  metricKey: MetricKey;
  label: string;
  lineage: LineageMetric | undefined;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current && !wrapperRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!lineage) return null;

  return (
    <div
      ref={wrapperRef}
      className={`lineage-wrap ${open ? 'open' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onFocus={() => setOpen(true)}
    >
      <button
        type="button"
        className="lineage-trigger"
        aria-label={`Explain ${label} metric lineage`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
        data-testid={`lineage-trigger-${metricKey}`}
      >
        How calculated
      </button>
      <div className="lineage-popover" id={panelId} role="dialog" aria-label={`${label} data lineage`}>
          <div className="lineage-header">
            <strong>{lineage.label}</strong>
            <div className="lineage-badges">
              {lineage.sources.map((source) => (
                <span className="tiny-badge source" key={source}>{source}</span>
              ))}
              {lineage.fallbackUsed ? <span className="tiny-badge fallback">Fallback</span> : <span className="tiny-badge live">Live</span>}
            </div>
          </div>
          <p className="lineage-desc">{lineage.description}</p>

          <div className="lineage-section">
            <h4>API query</h4>
            {lineage.queries.length > 0 ? (
              <ul>
                {lineage.queries.map((query, index) => (
                  <li key={`${query.url}-${index}`}>
                    <code>{query.method} {query.url}</code>
                    {query.note ? <small>{query.note}</small> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lineage-empty">This metric aggregates outputs from the other metrics and does not fetch APIs directly.</p>
            )}
          </div>

          <div className="lineage-section">
            <h4>Ingestion</h4>
            <ol>
              {lineage.ingestion.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>

          <div className="lineage-section">
            <h4>Transforms</h4>
            <ol>
              {lineage.transforms.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>

          <div className="lineage-section">
            <h4>Calculation</h4>
            <ol>
              {lineage.calculation.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>

          <div className="lineage-section">
            <h4>Config used</h4>
            <ul className="inline-paths">
              {lineage.configReferences.map((ref) => <li key={ref}><code>{ref}</code></li>)}
            </ul>
          </div>

          <div className="lineage-section">
            <h4>Current outputs</h4>
            <dl className="lineage-outputs">
              {Object.entries(lineage.outputs).map(([key, value]) => (
                <Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>{value == null ? 'n/a' : String(value)}</dd>
                </Fragment>
              ))}
            </dl>
          </div>

          {lineage.fallbackUsed ? (
            <div className="lineage-section fallback-note">
              <h4>Fallback</h4>
              <p>{lineage.fallbackReason ?? 'Fallback path was used.'}</p>
            </div>
          ) : null}
      </div>
    </div>
  );
}

function ProvenancePanel({ latest, meta }: { latest: LatestData; meta: MetaData }) {
  const provenance: Provenance | undefined = meta.provenance ?? latest.provenance;
  const freshness = freshnessInfo(latest.collectedAtUtc);
  const shortSha = provenance?.gitCommitSha ? provenance.gitCommitSha.slice(0, 7) : null;
  const sourceEntries = Object.entries(latest.sourceStatuses);

  return (
    <section className="panel provenance-panel" aria-labelledby="provenance-title">
      <div className="panel-header">
        <h2 id="provenance-title">Data Provenance</h2>
        <p>This is a static site; data is collected server-side and written into <code>data/*.json</code> before deployment.</p>
      </div>
      <div className="provenance-grid">
        <div className="provenance-card">
          <span className="muted">Generated by</span>
          <div>{provenance?.generatedBy === 'github-actions' ? 'GitHub Actions' : provenance?.generatedBy === 'local-cli' ? 'Local CLI' : 'Unavailable'}</div>
          <small>Collector v{provenance?.collectorVersion ?? 'n/a'}</small>
        </div>
        <div className="provenance-card">
          <span className="muted">Freshness</span>
          <div className={`freshness-badge ${freshness.className}`} data-testid="freshness-badge">{freshness.label}</div>
          <small>{Math.round(freshness.ageMinutes)} min since collection</small>
        </div>
        <div className="provenance-card">
          <span className="muted">Commit</span>
          <div title={provenance?.gitCommitSha ?? undefined}>{shortSha ?? 'n/a'}</div>
          <small>{provenance?.gitRef ?? 'No git ref metadata'}</small>
        </div>
        <div className="provenance-card">
          <span className="muted">Workflow run</span>
          {provenance?.runUrl ? (
            <a href={provenance.runUrl} target="_blank" rel="noreferrer" data-testid="workflow-run-link">Open Actions run</a>
          ) : (
            <div>n/a</div>
          )}
          <small>{provenance?.workflowName ?? 'No workflow metadata'}</small>
        </div>
      </div>
      <div className="provenance-meta">
        <div>
          <span className="muted">Repository / actor</span>
          <div>{provenance?.githubRepository ?? 'n/a'} {provenance?.githubActor ? `· ${provenance.githubActor}` : ''}</div>
        </div>
        <div>
          <span className="muted">Collection timestamp (UTC)</span>
          <div>{formatUtc(latest.collectedAtUtc)}</div>
        </div>
        <div>
          <span className="muted">Build timestamp (UTC)</span>
          <div>{formatUtc(meta.buildTimeUtc)}</div>
        </div>
      </div>
      <div className="source-status-list" aria-label="Source statuses">
        {sourceEntries.map(([source, status]) => (
          <span key={source} className={`status-pill ${status}`}>{source}: {status}</span>
        ))}
      </div>
    </section>
  );
}

function Chart({ history }: { history: HistoryData }) {
  const points = history.points.slice(-96);
  const line = buildSparkline(points, 640, 220);
  return (
    <section className="panel chart-panel" aria-labelledby="chart-title">
      <div className="panel-header">
        <h2 id="chart-title">24h Liveability Trend</h2>
        <p>{points.length} points from `history.json`</p>
      </div>
      <div className="chart-frame" role="img" aria-label="Line chart showing liveability score over the last 24 hours">
        <svg viewBox="0 0 640 220" preserveAspectRatio="none">
          {[0, 25, 50, 75, 100].map((tick) => (
            <g key={tick}>
              <line x1="0" x2="640" y1={220 - tick * 2.2} y2={220 - tick * 2.2} className="grid-line" />
              <text x="6" y={Math.max(12, 220 - tick * 2.2 - 4)} className="grid-label">
                {tick}
              </text>
            </g>
          ))}
          {line ? <polyline points={line} className="trend-line" /> : null}
          {points.length > 0 ? (
            <circle
              cx={points.length === 1 ? 320 : 640}
              cy={220 - (points.at(-1)!.score / 100) * 220}
              r="5"
              className="trend-dot"
            />
          ) : null}
        </svg>
      </div>
      <div className="chart-footer">
        <span>Oldest: {points[0] ? formatUtc(points[0].tsUtc) : 'n/a'}</span>
        <span>Latest: {points.at(-1) ? formatUtc(points.at(-1)!.tsUtc) : 'n/a'}</span>
      </div>
    </section>
  );
}

function KpiTile({
  metricKey,
  title,
  penalty,
  body,
  detail,
  lineage
}: {
  metricKey: Exclude<MetricKey, 'liveabilityScore'>;
  title: string;
  penalty: number;
  body: string;
  detail: string;
  lineage: LineageMetric | undefined;
}) {
  return (
    <article className="panel kpi-tile">
      <div className="kpi-top">
        <div className="metric-title-wrap">
          <h3>{title}</h3>
          <MetricLineagePopover metricKey={metricKey} label={title} lineage={lineage} />
        </div>
        <div className="chip">Penalty {penalty}</div>
      </div>
      <p>{body}</p>
      <small>{detail}</small>
    </article>
  );
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [latestRes, historyRes, metaRes] = await Promise.all([
          fetch('./data/latest.json'),
          fetch('./data/history.json'),
          fetch('./data/meta.json')
        ]);
        if (!latestRes.ok || !historyRes.ok || !metaRes.ok) {
          throw new Error('Failed to load dashboard data JSON files');
        }
        const [latest, history, meta] = (await Promise.all([
          latestRes.json(),
          historyRes.json(),
          metaRes.json()
        ])) as [LatestData, HistoryData, MetaData];

        if (cancelled) return;
        startTransition(() => {
          setState({ status: 'ready', latest, history, meta });
        });
      } catch (error) {
        if (cancelled) return;
        setState({ status: 'error', message: (error as Error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return <main className="shell"><div className="panel">Loading dashboard data…</div></main>;
  }

  if (state.status === 'error') {
    return (
      <main className="shell">
        <div className="panel error-panel">
          <h1>London Liveability Pulse</h1>
          <p>{state.message}</p>
        </div>
      </main>
    );
  }

  const { latest, history, meta } = state;
  const tone = scoreTone(latest.liveabilityScore);

  return (
    <main className="shell">
      <header className="hero panel">
        <div>
          <p className="eyebrow">{latest.project}</p>
          <h1>How painful is London right now?</h1>
          <p className="hero-copy">Static dashboard powered by GitHub Actions collector runs and config-as-code scoring.</p>
        </div>
        <div className={`score-card ${tone}`} data-testid="score-card">
          <div className="metric-title-wrap score-title-wrap">
            <span className="score-label">Liveability score</span>
            <MetricLineagePopover metricKey="liveabilityScore" label="Liveability score" lineage={latest.lineage?.metrics.liveabilityScore} />
          </div>
          <strong data-testid="liveability-score">{latest.liveabilityScore.toFixed(1)}</strong>
          <small>100 is best</small>
        </div>
      </header>

      <section className="panel timestamp-panel" aria-label="Last updated times">
        <div>
          <span className="muted">Last updated (UTC)</span>
          <div>{formatUtc(latest.collectedAtUtc)}</div>
        </div>
        <div>
          <span className="muted">Last updated ({latest.timezone})</span>
          <div>{latest.collectedAtLocal}</div>
        </div>
        <div>
          <span className="muted">Build metadata</span>
          <div>{formatUtc(meta.buildTimeUtc)}</div>
        </div>
      </section>

      <ProvenancePanel latest={latest} meta={meta} />

      <section className="kpi-grid" aria-label="KPI tiles">
        <KpiTile
          metricKey="transit"
          title="Transit disruption"
          penalty={latest.kpis.transit.penalty}
          body={`${latest.kpis.transit.disruptedLines} disrupted lines across ${latest.kpis.transit.watchedLines} watched lines.`}
          detail={latest.whatChanged.topDisruptedLines[0] ? `Worst: ${latest.whatChanged.topDisruptedLines[0].line} (${latest.whatChanged.topDisruptedLines[0].status})` : 'No major disruptions detected.'}
          lineage={latest.lineage?.metrics.transit}
        />
        <KpiTile
          metricKey="wait"
          title="Commute wait"
          penalty={latest.kpis.wait.penalty}
          body={latest.kpis.wait.worstStopPoint ? `${latest.kpis.wait.worstStopPoint} is the worst watched stop.` : 'No arrivals available for watched stops.'}
          detail={latest.kpis.wait.medianMinutes != null ? `Median wait ${latest.kpis.wait.medianMinutes} min` : 'Median wait unavailable'}
          lineage={latest.lineage?.metrics.wait}
        />
        <KpiTile
          metricKey="weather"
          title="Weather discomfort"
          penalty={latest.kpis.weather.penalty}
          body={`Rain risk max ${latest.kpis.weather.maxRainProbabilityNext6h ?? 'n/a'}% in the next 6 hours.`}
          detail={`Temp ${latest.kpis.weather.representativeTempNext6h ?? 'n/a'}°C, wind ${latest.kpis.weather.maxWindSpeedNext6h ?? 'n/a'} km/h`}
          lineage={latest.lineage?.metrics.weather}
        />
        <KpiTile
          metricKey="air"
          title="Air quality"
          penalty={latest.kpis.air.penalty}
          body={`London-wide max AQI ${latest.kpis.air.maxIndex ?? 'n/a'} (${latest.kpis.air.band ?? 'unknown'}).`}
          detail={latest.whatChanged.airQuality.stationName ? `Observed at ${latest.whatChanged.airQuality.stationName}` : 'Station attribution unavailable'}
          lineage={latest.lineage?.metrics.air}
        />
      </section>

      <Chart history={history} />

      <section className="panel changes-panel" aria-labelledby="changes-title">
        <div className="panel-header">
          <h2 id="changes-title">What changed?</h2>
          <p>Top contributors to current score movement.</p>
        </div>
        <div className="changes-grid">
          <article>
            <h3>Top disrupted lines</h3>
            <ul>
              {latest.whatChanged.topDisruptedLines.length > 0 ? (
                latest.whatChanged.topDisruptedLines.map((line) => (
                  <li key={line.line}>
                    <span>{line.line}</span>
                    <span>{line.status}</span>
                    <span>{line.severityPoints} pts</span>
                  </li>
                ))
              ) : (
                <li className="empty-row">No disruptions in watchlist.</li>
              )}
            </ul>
          </article>
          <article>
            <h3>Worst stop point</h3>
            {latest.whatChanged.worstStopPoint ? (
              <p>
                {latest.whatChanged.worstStopPoint.label}: <strong>{latest.whatChanged.worstStopPoint.medianMinutes} min</strong> median for next arrivals.
              </p>
            ) : (
              <p>No stop point arrival data available.</p>
            )}
          </article>
          <article>
            <h3>Rain probability (6h)</h3>
            <p>
              Max rain probability: <strong>{latest.whatChanged.maxRainProbabilityNext6h ?? 'n/a'}%</strong>
            </p>
          </article>
          <article>
            <h3>Air quality</h3>
            <p>
              Max index: <strong>{latest.whatChanged.airQuality.maxIndex ?? 'n/a'}</strong> ({latest.whatChanged.airQuality.band ?? 'unknown'})
            </p>
          </article>
        </div>
        {latest.warnings.length > 0 ? (
          <div className="warnings" role="status" aria-live="polite">
            <h3>Collector warnings</h3>
            <ul>
              {latest.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}
