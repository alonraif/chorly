import { PrismaClient } from '@prisma/client';
import { TEMPLATE_CHORES } from '../src/common/templates/template-catalog';
import { hashPassword } from '../src/common/auth/password';

const prisma = new PrismaClient();

async function seedTenant(tenantId: string, tenantName: string, passwordHash: string) {
  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { name: tenantName },
    create: { id: tenantId, name: tenantName, currencyCode: 'ILS', defaultLocale: 'he' },
  });

  const admin = await prisma.user.upsert({
    where: { email: `admin+${tenantId}@chorly.local` },
    update: { tenantId: tenant.id, isAdmin: true, isActive: true, passwordHash, role: 'parent' },
    create: { tenantId: tenant.id, email: `admin+${tenantId}@chorly.local`, passwordHash, displayName: `Admin ${tenantId}`, role: 'parent', isAdmin: true, locale: 'he' },
  });

  const member1 = await prisma.user.upsert({
    where: { email: `member1+${tenantId}@chorly.local` },
    update: { tenantId: tenant.id, isAdmin: false, isActive: true, passwordHash, role: 'child' },
    create: { tenantId: tenant.id, email: `member1+${tenantId}@chorly.local`, passwordHash, displayName: 'Noa', role: 'child', isAdmin: false, locale: 'he' },
  });

  const member2 = await prisma.user.upsert({
    where: { email: `member2+${tenantId}@chorly.local` },
    update: { tenantId: tenant.id, isAdmin: false, isActive: true, passwordHash, role: 'child' },
    create: { tenantId: tenant.id, email: `member2+${tenantId}@chorly.local`, passwordHash, displayName: 'Daniel', role: 'child', isAdmin: false, locale: 'en' },
  });

  for (const template of TEMPLATE_CHORES) {
    const templateId = `template-${template.title_en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tenant.id}`;
    await prisma.choreDefinition.upsert({
      where: { id: templateId },
      update: {
        title_en: template.title_en,
        title_he: template.title_he,
        scheduleJson: template.scheduleJson,
        assignmentJson: { mode: 'fixed', shared: false, skipAwayUsers: true, assigneeIds: [member1.id, member2.id] },
        isTemplate: true,
        deletedAt: null,
      },
      create: {
        id: templateId,
        tenantId: tenant.id,
        title_en: template.title_en,
        title_he: template.title_he,
        hasReward: false,
        rewardAmount: null,
        allowNotes: true,
        allowPhotoProof: false,
        scheduleJson: template.scheduleJson,
        assignmentJson: { mode: 'fixed', shared: false, skipAwayUsers: true, assigneeIds: [member1.id, member2.id] },
        isTemplate: true,
      },
    });
  }

  return { tenantId: tenant.id, adminId: admin.id, users: [member1.id, member2.id] };
}

// Dev-only sample data. Production starts empty and uses the first-run setup screen.
async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed sample users in production');
  }
  const devTenantId = process.env.DEV_TENANT_ID || 'dev-tenant';
  const seedPassword = process.env.SEED_USER_PASSWORD || 'Password123!';
  const passwordHash = await hashPassword(seedPassword);

  const seeded = await seedTenant(devTenantId, 'Dev Family', passwordHash);

  console.log('Seed complete', { tenant: seeded, templates: TEMPLATE_CHORES.length, seedPassword });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
