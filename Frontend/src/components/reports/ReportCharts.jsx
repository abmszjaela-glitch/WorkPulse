import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Heading from '../ui/SectionHeading.jsx'
import { formatReportTime } from '../../data/reports.js'
const panel = 'rounded-2xl border border-line/70 bg-white shadow-card'
const chartTick = { fill: '#53649b', fontSize: 11 }
export default function ReportCharts({ report, applied, charts, categories }) {
  return (
    <>
      {' '}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.42fr)_minmax(0,1fr)]">
        <section className={`${panel} p-6`}>
          <Heading
            title="Active vs. Idle Time Distribution"
            subtitle="Illustrative daily hours per employee"
          >
            <div className="flex gap-3 text-[10px]">
              <span className="flex items-center gap-1.5">
                <i className="size-2.5 rounded bg-primary" />
                Active
              </span>
              <span className="flex items-center gap-1.5">
                <i className="size-2.5 rounded bg-indigo-300" />
                Idle
              </span>
              <span className="rounded bg-soft px-2 text-muted-strong">
                {applied.days === 1
                  ? 'Daily'
                  : applied.days === 30
                    ? 'Monthly'
                    : 'Weekly'}
              </span>
            </div>
          </Heading>
          <div className="mt-7 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts} margin={{ left: -18, right: 5, top: 10 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="#e0e7ff"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={chartTick}
                />
                <YAxis
                  tick={chartTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `${value}h`}
                />
                <Tooltip formatter={(value, name) => [`${value}h`, name]} />
                <Bar
                  dataKey="active"
                  name="Active"
                  fill="#2563eb"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={24}
                />
                <Bar
                  dataKey="idle"
                  name="Idle"
                  fill="#b7c3ff"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className={`${panel} p-6`}>
          <Heading
            title="Productivity by Category"
            subtitle="Illustrative classification of tracked time"
          >
            <span className="text-[10px] text-muted">
              {applied.department || 'All Teams'}
            </span>
          </Heading>
          <div className="relative mx-auto my-6 size-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categories}
                  dataKey="value"
                  innerRadius="73%"
                  outerRadius="98%"
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                >
                  {categories.map((category) => (
                    <Cell key={category.name} fill={category.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatReportTime(value)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <strong className="text-2xl font-bold tracking-tight text-ink">
                {formatReportTime(report.avgDaily)}
              </strong>
              <small className="text-[10px] font-medium text-muted-strong">
                AVG DAILY
              </small>
            </div>
          </div>
          <div className="space-y-2 border-t border-line/70 pt-3">
            {categories.map((category) => (
              <div
                key={category.name}
                className="flex items-center gap-2 text-[11px]"
              >
                <i
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: category.color }}
                />
                <span className="text-ink">{category.name}</span>
                <span className="ml-auto text-[10px] text-muted-strong">
                  {formatReportTime(
                    Math.round(
                      category.value /
                        Math.max(1, report.rows.length * report.workDays),
                    ),
                  )}
                </span>
                <strong
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{
                    color: category.color,
                    background: `${category.color}12`,
                  }}
                >
                  {report.totalMinutes
                    ? Math.round((category.value / report.totalMinutes) * 100)
                    : 0}
                  %
                </strong>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className={`${panel} p-6`}>
          <Heading
            title="Productivity Trend vs Benchmark"
            subtitle="Illustrative daily ratio against organizational target"
          >
            <span className="rounded bg-soft px-2 py-1 text-[10px] text-muted-strong">
              ○ Target: 75%
            </span>
          </Heading>
          <div className="mt-7 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={charts}
                margin={{ left: -15, right: 12, top: 10 }}
              >
                <defs>
                  <linearGradient
                    id="reportTrendFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#e0e7ff"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={chartTick}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  axisLine={false}
                  tickLine={false}
                  tick={chartTick}
                />
                <Tooltip formatter={(value) => [`${value}%`, 'Productivity']} />
                <ReferenceLine y={75} stroke="#2563eb" strokeDasharray="4 4" />
                <Area
                  type="monotone"
                  dataKey="productivity"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  fill="url(#reportTrendFill)"
                  dot={{ r: 3, fill: 'white', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className={`${panel} p-6`}>
          <Heading
            title="Department Comparison"
            subtitle="Efficiency rankings indexed against 75% baseline"
          >
            <span className="rounded bg-green-50 px-2 py-1 text-[10px] text-success-strong">
              {report.groups.filter((group) => group.productivity >= 75).length}{' '}
              Exceeding
            </span>
          </Heading>
          <div className="mt-5 space-y-4">
            {report.groups.map((group) => (
              <div key={group.name}>
                <div className="mb-1.5 flex items-center gap-2 text-xs">
                  <strong className="font-medium text-ink">{group.name}</strong>
                  <span className="ml-auto text-[10px] text-muted-strong">
                    {group.staff} staff
                  </span>
                  <strong
                    className={
                      group.productivity >= 80
                        ? 'text-success-strong'
                        : 'text-primary'
                    }
                  >
                    {group.productivity}%
                  </strong>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${group.productivity >= 80 ? 'bg-success-strong' : 'bg-primary'}`}
                    style={{ width: `${group.productivity}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
