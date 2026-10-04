# Vercel production checklist

The production alias is `https://flowcare-five.vercel.app`.

## Required environment variables

Configure these in Vercel for the Production environment, never in committed files:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `FLOWCARE_LIVE_READS=true`
- `FLOWCARE_DEMO_MODE=false`

After changing environment variables, trigger a new production deployment.

## Cron limitation

`vercel.json` schedules `/api/cron/care-recovery`. Vercel Hobby permits only one cron execution per day, so the checked-in schedule is daily. A Pro plan can use a shorter interval such as every 15 minutes, which is preferable for approval deadlines.

## Smoke checks

```bash
curl -sS https://flowcare-five.vercel.app/api/config
curl -sS 'https://flowcare-five.vercel.app/api/hospitals/search?pageSize=3'
```

The config response should report `demoMode: false`, `liveReads: true`, and `careAccess.systemTransitionsConfigured: true` after the service-role key is configured. Authenticated hospital and patient workflow checks must be performed with test accounts; anonymous operational endpoints should return 401.
