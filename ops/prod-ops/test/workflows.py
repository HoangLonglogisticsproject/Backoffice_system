"""Static rules for the production-ops workflows - the properties a reviewer
would otherwise have to re-check by eye on every change. Needs PyYAML (present
on GitHub's ubuntu runners). Exit 1 on any violation."""
import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / '.github' / 'workflows'
PROD = {'prod-trip-audit.yml': 'trip-confirmed-audit', 'prod-trip-normalize.yml': 'trip-confirmed-normalize'}
PINNED = re.compile(r'^[\w.-]+/[\w.-]+@[0-9a-f]{40}$')
failures = []


def rule(ok, message):
    print(f"  {'ok  ' if ok else 'FAIL'}  {message}")
    if not ok:
        failures.append(message)


def load(path):
    data = yaml.safe_load(path.read_text(encoding='utf-8'))
    data['on'] = data.pop(True, data.get('on'))  # YAML 1.1 reads a bare `on:` as True
    return data


def steps(job):
    return job.get('steps', [])


for name, operation in PROD.items():
    print(f'== {name}')
    text = (WORKFLOWS / name).read_text(encoding='utf-8')
    wf = load(WORKFLOWS / name)
    rule(list(wf['on']) == ['workflow_dispatch'], 'workflow_dispatch is the only trigger')
    rule(wf.get('permissions') == {'contents': 'read'}, 'permissions are exactly contents: read')
    rule(wf.get('concurrency', {}).get('group') == 'production-ops'
         and wf['concurrency'].get('cancel-in-progress') is False, 'one production operation at a time, never cancelled')
    for job_id, job in wf['jobs'].items():
        job_text = yaml.safe_dump(job)
        holds_secrets = 'secrets.' in job_text
        rule("github.ref == 'refs/heads/main'" in str(job.get('if', '')), f'{job_id}: runs from main only')
        rule(not holds_secrets or job.get('environment') == 'production',
             f'{job_id}: secrets only inside the production environment')
        rule('permissions' not in job, f'{job_id}: does not widen permissions')
        for step in steps(job):
            if 'uses' in step:
                rule(bool(PINNED.match(step['uses'])), f"{job_id}: {step['uses'].split('@')[0]} pinned to a commit")
                rule(step.get('with', {}).get('persist-credentials') is False,
                     f'{job_id}: checkout leaves no token behind')
            run = step.get('run', '')
            rule('${{' not in run, f"{job_id}/{step.get('name', 'step')}: no expression interpolated into a script")
            for command in re.findall(r'ssh -F "\$PROD_OPS_SSH_CONFIG" prod-ops (\S+)', run):
                rule(command in {operation, 'trip-confirmed-audit'}, f'{job_id}: ssh sends only a known operation ({command})')
    rule('StrictHostKeyChecking=no' not in text and 'ssh-keyscan' not in text, 'no TOFU host key handling')
    rule(operation in text, f'runs {operation}')

audit = (WORKFLOWS / 'prod-trip-audit.yml').read_text(encoding='utf-8')
rule('trip-confirmed-normalize' not in audit, 'the audit workflow can never start the normalization')

print('== prod-trip-normalize.yml inputs and jobs')
normalize = load(WORKFLOWS / 'prod-trip-normalize.yml')
inputs = normalize['on']['workflow_dispatch']['inputs']
rule(set(inputs) == {'trip_ids', 'actor_email', 'expected_release_sha'}, 'exactly the three inputs')
rule(all(spec.get('required') is True and spec.get('type') == 'string' for spec in inputs.values()), 'all required strings')
validate, apply = normalize['jobs']['validate'], normalize['jobs']['normalize']
rule('environment' not in validate and 'secrets.' not in yaml.safe_dump(validate),
     'validation runs with no environment and no secret')
rule(apply.get('needs') == 'validate', 'nothing reaches production before validation passed')
first_ssh = next(i for i, s in enumerate(steps(apply)) if 'ssh -F' in s.get('run', ''))
rule(any('normalize-request.sh' in s.get('run', '') for s in steps(apply)[:first_ssh]),
     'the request is re-validated in the production job before the first ssh')

print('== ops-checks.yml - must work as a REQUIRED check on main')
checks = load(WORKFLOWS / 'ops-checks.yml')
triggers = checks['on']
rule('pull_request' in triggers and not (triggers['pull_request'] or {}).get('paths'),
     'runs on every pull request (a paths filter would leave a required check unreported)')
rule(checks.get('permissions') == {'contents': 'read'}, 'permissions are exactly contents: read')
rule('secrets.' not in (WORKFLOWS / 'ops-checks.yml').read_text(encoding='utf-8')
     and all('environment' not in job for job in checks['jobs'].values()), 'no secret and no environment')
rule(list(checks['jobs']) == ['ops'] and checks['jobs']['ops']['name'].startswith('ops · '),
     'one job, named as branch protection requires it')

print('== every other workflow')
for path in sorted(WORKFLOWS.glob('*.yml')):
    if path.name in PROD:
        continue
    text = path.read_text(encoding='utf-8')
    rule('PROD_OPS_' not in text and 'environment: production' not in text,
         f'{path.name}: no production-ops secret or environment')
    rule('bo-prod-ops' not in text or path.name == 'ops-checks.yml', f'{path.name}: does not call bo-prod-ops')

print(f"\nworkflows: {len(failures)} failed")
sys.exit(1 if failures else 0)
