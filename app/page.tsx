import {
  Users,
  School,
  GraduationCap,
  BookOpen,
  Wallet,
  TrendingUp,
  AlertTriangle,
  UserPlus,
  PencilRuler,
  FileText,
  CircleDollarSign,
  ArrowRight,
  Info,
} from 'lucide-react'

import { PageHeader } from '@/components/page-header'
import { LinkButton } from '@/components/link-button'
import { StatCard } from '@/components/stat-card'
import { PaymentBadge } from '@/components/payment-badge'
import { FinanceChart, CycleChart } from '@/components/dashboard/charts'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatFCFA } from '@/lib/data'
import type { Alerte } from '@/lib/queries/dashboard'
import { getDashboard } from '@/lib/queries/dashboard'

const quickActions = [
  { label: 'Inscrire un élève', href: '/inscriptions', icon: UserPlus },
  { label: 'Enregistrer un paiement', href: '/finances', icon: CircleDollarSign },
  { label: 'Saisir une note', href: '/notes', icon: PencilRuler },
  { label: 'Générer un bulletin', href: '/bulletins', icon: FileText },
]

const alerteStyles: Record<Alerte['severite'], string> = {
  haute: 'text-destructive bg-destructive/10',
  moyenne: 'text-chart-3 bg-chart-3/15',
  basse: 'text-chart-2 bg-chart-2/15',
  info: 'text-muted-foreground bg-muted',
}

export default async function DashboardPage() {
  const data = await getDashboard()
  const { kpis } = data

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={`${data.etablissement.anneeScolaire || 'Année en cours'} — ${data.etablissement.nom}`}
      >
        <LinkButton href="/finances" variant="outline">
          <Wallet className="size-4" data-icon="inline-start" />
          Encaissements
        </LinkButton>
        <LinkButton href="/inscriptions">
          <UserPlus className="size-4" data-icon="inline-start" />
          Inscrire un élève
        </LinkButton>
      </PageHeader>

      {/* Indicateurs scolaires */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Élèves" value={kpis.totalEleves} hint={`${kpis.totalInscriptions} nouveaux`} icon={Users} accent="primary" />
        <StatCard label="Classes" value={kpis.totalClasses} icon={School} accent="sky" />
        <StatCard label="Enseignants" value={kpis.totalEnseignants} icon={GraduationCap} accent="primary" />
        <StatCard label="Matières" value={kpis.totalMatieres} icon={BookOpen} accent="sky" />
        <StatCard label="À jour / retard" value={`${kpis.elevesAJour} / ${kpis.elevesEnRetard}`} icon={Users} accent="amber" />
      </section>

      {/* Indicateurs financiers + recouvrement */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Situation financière</CardTitle>
            <CardDescription>
              Année {data.etablissement.anneeScolaire}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Montant attendu</span>
                <span className="text-xl font-semibold tabular-nums">{formatFCFA(kpis.montantAttendu)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Montant encaissé</span>
                <span className="text-xl font-semibold tabular-nums text-primary">{formatFCFA(kpis.montantEncaisse)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Reste à recouvrer</span>
                <span className="text-xl font-semibold tabular-nums text-destructive">{formatFCFA(kpis.resteRecouvrer)}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingUp className="size-4" />
                  Taux de recouvrement
                </span>
                <span className="font-semibold tabular-nums">{kpis.tauxRecouvrement}%</span>
              </div>
              <Progress value={kpis.tauxRecouvrement} />
            </div>
            <Separator />
            <FinanceChart data={data.encaissementsMensuels} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Répartition des élèves</CardTitle>
            <CardDescription>Par cycle d&apos;enseignement</CardDescription>
          </CardHeader>
          <CardContent>
            <CycleChart data={data.repartitionCycle} />
          </CardContent>
        </Card>
      </section>

      {/* Alertes + Actions rapides */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-chart-3" />
              Alertes
            </CardTitle>
            <CardDescription>Éléments qui requièrent votre attention</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.alertes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune alerte en cours — tout est à jour.
              </p>
            ) : (
              data.alertes.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3"
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-md ${alerteStyles[a.severite]}`}
                  >
                    <Info className="size-4" />
                  </span>
                  <span className="text-sm">{a.message}</span>
                  <Badge variant="outline" className="ml-auto capitalize">
                    {a.type.replace('_', ' ')}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actions rapides</CardTitle>
            <CardDescription>Raccourcis fréquents</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2">
            {quickActions.map((action) => (
              <LinkButton
                key={action.href}
                href={action.href}
                variant="outline"
                className="justify-start"
              >
                <action.icon className="size-4" data-icon="inline-start" />
                {action.label}
                <ArrowRight className="ml-auto size-4" data-icon="inline-end" />
              </LinkButton>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Derniers paiements */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Derniers paiements</CardTitle>
            <CardDescription>Encaissements récents</CardDescription>
          </div>
          <LinkButton href="/finances" variant="ghost" size="sm">
            Tout voir
            <ArrowRight className="size-4" data-icon="inline-end" />
          </LinkButton>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reçu</TableHead>
                <TableHead>Élève</TableHead>
                <TableHead className="hidden sm:table-cell">Motif</TableHead>
                <TableHead className="hidden md:table-cell">Mode</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.derniersPaiements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Aucun paiement enregistré pour l&apos;instant.
                  </TableCell>
                </TableRow>
              ) : (
                data.derniersPaiements.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.recu ?? '—'}</TableCell>
                    <TableCell className="font-medium">{p.eleve ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">{p.motif ?? '—'}</TableCell>
                    <TableCell className="hidden md:table-cell">{p.mode}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatFCFA(p.montant)}
                    </TableCell>
                    <TableCell>
                      <PaymentBadge statut={p.statutPaiement} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}