# OpsGate × Prometheus / Grafana (V2 P0)

> **Roadmap produit V3** (Secure Rewrite, Risk Score, Shadow AI…) :  
> dossier dédié [`../roadmap-v3/`](../roadmap-v3/) — ne pas mélanger avec Grafana.

## Metrics endpoint

```
GET http://127.0.0.1:8787/metrics
```

Content-Type : `text/plain; version=0.0.4`

### Auth optionnelle

```powershell
$env:OPSGATE_METRICS_TOKEN="change-me"
# puis :
# Authorization: Bearer change-me
# ou ?token=change-me
```

### Principales métriques

| Métrique | Type | Description |
|----------|------|-------------|
| `opsgate_up` | gauge | API vivante |
| `opsgate_agents{org_id,status}` | gauge | online / stale / offline_long / maintenance / total |
| `opsgate_agents_licensed` | gauge | Sièges licenciés |
| `opsgate_agents_unlicensed` | gauge | Sans licence |
| `opsgate_seats` / `opsgate_seats_used` | gauge | Pool licences |
| `opsgate_events_stored` | gauge | Events en store (échantillon) |
| `opsgate_events_by_decision` | gauge | Répartition décisions (échantillon) |
| `opsgate_events_accepted_total` | counter | Acceptés depuis le démarrage API |
| `opsgate_events_accepted_by_decision_total` | counter | Idem par décision |
| `opsgate_events_forwarded_siem_total` | counter | Forwardés Syslog |
| `opsgate_siem_enabled` | gauge | 1 si SIEM org actif |

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: opsgate
    scrape_interval: 30s
    static_configs:
      - targets: ["127.0.0.1:8787"]
    # metrics_path: /metrics
    # authorization:
    #   credentials: change-me
```

## Grafana

1. Data source Prometheus → votre instance.  
2. **Import** → upload `opsgate-dashboard.json` (ce dossier).  
3. UID : `opsgate-security-fleet`.

## SIEM / Syslog (console)

**Paramètres → Monitoring → SIEM / Syslog**

- Protocol UDP ou TCP  
- Format **RFC 5424** ou **CEF**  
- Facility défaut `16` (local0)  

Test local (PowerShell, écoute UDP 5514) :

```powershell
# Terminal A — récepteur basique
$udp = New-Object System.Net.Sockets.UdpClient 5514
while ($true) {
  $ep = New-Object System.Net.IPEndPoint([Net.IPAddress]::Any, 0)
  $b = $udp.Receive([ref]$ep)
  [Text.Encoding]::UTF8.GetString($b)
}
```

Console : host `127.0.0.1`, port `5514`, enabled ON, Enregistrer.  
Puis générer un event (proxy ou extension) → ligne syslog visible.
