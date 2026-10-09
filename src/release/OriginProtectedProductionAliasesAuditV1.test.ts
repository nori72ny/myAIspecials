import { describe, expect, it } from 'vitest';
import {
  ORIGIN_PROTECTED_PRODUCTION_HOSTS as hosts,
  auditOriginProtectedProductionAliasesV1 as audit,
  type OriginTrustedProductionAliasSnapshotV1,
} from './OriginProtectedProductionAliasesAuditV1.js';

const approvedSha = 'a'.repeat(40);
const projectId = 'prj_WecnnicbGAamToppgV97rHgd8QSB';
const oldPrimary = 'dpl_EQC4xWGW9hY9SkzkxXuTwxs7uLrP';
const oldSecondary = 'dpl_AV9BVPv2kjDcUJxHu6BoW45PGJJh';
const newMain = 'dpl_B2RjFGaDhb8JCfHLrGaV8yNR7Xxh';
const good = () => {
  const snapshot: OriginTrustedProductionAliasSnapshotV1 = {
    projectId, approvedSha,
    deploymentsByHostname: {
      [hosts[0]]: oldPrimary, [hosts[1]]: oldSecondary, [hosts[2]]: oldSecondary,
    },
  };
  return {
    snapshot,
    aliases: hosts.map(host => ({
      alias: host,
      deploymentId: snapshot.deploymentsByHostname[host],
      projectId,
    })),
    deployments: [oldPrimary, oldSecondary].map(id => ({
      id, projectId, readyState: 'READY', target: 'production',
      meta: { githubCommitSha: approvedSha },
    })),
  };
};

describe('ORIGIN real three-Production-alias hold auditing', () => {
  it('accepts a complete unchanged pre-push snapshot, NEVER authorizes publication', () => {
    const v = good();
    const out = audit(v.snapshot, v.aliases, v.deployments);
    expect(out).toEqual({
      schemaVersion: 'origin.protected-production-aliases.v1',
      allProtectedProductionAliasesHeld: true,
      firstNewMainPushNegativePathVerified: false,
      productionPromotionAuthorized: false,
      blockers: [],
    });
  });

  it('reproduces the real risk: main primary holds while BOTH Vercel defaults jump to new SHA', () => {
    const v = good();
    v.aliases[1].deploymentId = newMain;
    v.aliases[2].deploymentId = newMain;
    const out = audit(v.snapshot, v.aliases, v.deployments);
    expect(out.allProtectedProductionAliasesHeld).toBe(false);
    expect(out.blockers).toContain('PROTECTED_ALIAS_MOVED');
  });

  it('fails even if ONLY ONE default domain drifts', () => {
    const v = good();
    v.aliases[2].deploymentId = newMain;
    expect(audit(v.snapshot, v.aliases, v.deployments).blockers)
      .toContain('PROTECTED_ALIAS_MOVED');
  });

  it.each([
    ['missing alias', (v: ReturnType<typeof good>) => { v.aliases.pop(); }],
    ['duplicate alias', (v: ReturnType<typeof good>) => { v.aliases[1] = v.aliases[0]; }],
    ['unknown alias', (v: ReturnType<typeof good>) => { v.aliases[0].alias = 'attacker.invalid'; }],
    ['different alias project', (v: ReturnType<typeof good>) => { v.aliases[0].projectId = 'prj_wrong_identifier123'; }],
    ['missing deployment', (v: ReturnType<typeof good>) => { v.deployments.pop(); }],
    ['duplicate deployment', (v: ReturnType<typeof good>) => { v.deployments[1] = v.deployments[0]; }],
    ['wrong deployment project', (v: ReturnType<typeof good>) => { v.deployments[1].projectId = 'prj_wrong_identifier123'; }],
    ['preview as Production', (v: ReturnType<typeof good>) => { v.deployments[1].target = 'preview'; }],
    ['unready Production', (v: ReturnType<typeof good>) => { v.deployments[1].readyState = 'BUILDING'; }],
    ['same id but new SHA', (v: ReturnType<typeof good>) => { v.deployments[1].meta.githubCommitSha = 'b'.repeat(40); }],
  ])('fails closed on %s', (_label, mutate) => {
    const v = good();
    mutate(v);
    expect(audit(v.snapshot, v.aliases, v.deployments).allProtectedProductionAliasesHeld)
      .toBe(false);
  });

  it.each([null, undefined, false, {}, [], 'approved', { projectId, approvedSha }])(
    'rejects untrusted or incomplete snapshot: %j', snapshot => {
      const v = good();
      const out = audit(snapshot, v.aliases, v.deployments);
      expect(out.allProtectedProductionAliasesHeld).toBe(false);
      expect(out.blockers).toContain('TRUSTED_PRODUCTION_SNAPSHOT_INVALID');
    },
  );

  it('does not accept a malformed or incomplete protected hostname list', () => {
    const v = good();
    const bad = { ...v.snapshot, deploymentsByHostname: {
      [hosts[0]]: oldPrimary, [hosts[1]]: oldSecondary,
    } };
    expect(audit(bad, v.aliases, v.deployments).allProtectedProductionAliasesHeld).toBe(false);
  });

  it('allows structurally valid real alias API responses omitting projectId', () => {
    const v = good();
    const withoutProject = v.aliases.map(({ alias, deploymentId }) => ({ alias, deploymentId }));
    expect(audit(v.snapshot, withoutProject, v.deployments).allProtectedProductionAliasesHeld)
      .toBe(true);
  });
});
