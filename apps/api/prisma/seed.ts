import { PrismaClient } from '@prisma/client';
import { TEMPLATE_CHORES } from '../src/common/templates/template-catalog';

const prisma = new PrismaClient();

async function seedTenant(tenantId: string, tenantName: string) {
  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: { name: tenantName },
    create: { id: tenantId, name: tenantName, currencyCode: 'ILS', defaultLocale: 'he' },
  });

  const admin = await prisma.user.upsert({
    where: { email: `admin+${tenantId}@chorly.local` },
    update: { tenantId: tenant.id, isAdmin: true, isActive: true },
    create: { tenantId: tenant.id, email: `admin+${tenantId}@chorly.local`, displayName: `Admin ${tenantId}`, isAdmin: true, locale: 'he' },
  });

  const member1 = await prisma.user.upsert({
    where: { email: `member1+${tenantId}@chorly.local` },
    update: { tenantId: tenant.id, isAdmin: false, isActive: true },
    create: { tenantId: tenant.id, email: `member1+${tenantId}@chorly.local`, displayName: 'Noa', isAdmin: false, locale: 'he' },
  });

  const member2 = await prisma.user.upsert({
    where: { email: `member2+${tenantId}@chorly.local` },
    update: { tenantId: tenant.id, isAdmin: false, isActive: true },
    create: { tenantId: tenant.id, email: `member2+${tenantId}@chorly.local`, displayName: 'Daniel', isAdmin: false, locale: 'en' },
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

async function main() {
  const devTenantId = process.env.DEV_TENANT_ID || 'dev-tenant';

  await prisma.tenant.upsert({
    where: { id: devTenantId },
    update: { name: 'Dev Family' },
    create: { id: devTenantId, name: 'Dev Family', currencyCode: 'ILS', defaultLocale: 'he' },
  });

  const system = await prisma.user.upsert({
    where: { email: 'root@chorly.local' },
    update: { isSystemAdmin: true, isAdmin: true, isActive: true },
    create: {
      tenantId: devTenantId,
      email: 'root@chorly.local',
      displayName: 'Chorly Root',
      isAdmin: true,
      isSystemAdmin: true,
      locale: 'en',
    },
  });

  const seededA = await seedTenant(devTenantId, 'Dev Family');
  const seededB = await seedTenant('demo-tenant', 'Demo Family');

  await prisma.user.update({ where: { id: system.id }, data: { tenantId: devTenantId } });

  console.log('Seed complete', { systemAdminId: system.id, tenants: [seededA, seededB], templates: TEMPLATE_CHORES.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
