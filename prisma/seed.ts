import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Seed configuration
const CONFIG = {
  branches: 2,
  serviceTypesPerBranch: 3,
  staffPerBranch: 2,
  managersPerBranch: 1,
  slotDays: 5, // Next 5 days
  slotsPerDay: 8, // 8 time slots per day
};

async function main() {
  console.log('🌱 Starting FlowCare database seed...');
  
  // Clear existing data (in reverse order of dependencies)
  console.log('🧹 Clearing existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.slotAssignment.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.serviceType.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.user.deleteMany();
  
  const hashedPassword = await bcrypt.hash('password123', 10);
  
  // ============================================
  // Create Admin User
  // ============================================
  console.log('👤 Creating admin user...');
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@flowcare.com',
      password: hashedPassword,
      firstName: 'System',
      lastName: 'Administrator',
      role: Role.ADMIN,
      phone: '+968 9000 0000',
    },
  });
  console.log(`   ✓ Admin: ${adminUser.email}`);
  
  // ============================================
  // Create Branches
  // ============================================
  console.log(`🏢 Creating ${CONFIG.branches} branches...`);
  const branches = await Promise.all([
    prisma.branch.create({
      data: {
        name: 'Muscat Main Branch',
        code: 'MCT-001',
        address: 'Al Khuwair Street, Building 123',
        city: 'Muscat',
        phone: '+968 2400 0000',
        email: 'muscat@flowcare.com',
        isActive: true,
        timezone: 'Asia/Muscat',
      },
    }),
    prisma.branch.create({
      data: {
        name: 'Salalah Branch',
        code: 'SLL-001',
        address: 'Al Dahna Street, Building 456',
        city: 'Salalah',
        phone: '+968 2300 0000',
        email: 'salalah@flowcare.com',
        isActive: true,
        timezone: 'Asia/Muscat',
      },
    }),
  ]);
  branches.forEach(b => console.log(`   ✓ Branch: ${b.name} (${b.code})`));
  
  // ============================================
  // Create Service Types per Branch
  // ============================================
  console.log(`📋 Creating ${CONFIG.serviceTypesPerBranch} service types per branch...`);
  const allServiceTypes: any[] = [];
  
  for (const branch of branches) {
    const serviceTypes = await Promise.all([
      prisma.serviceType.create({
        data: {
          branchId: branch.id,
          name: 'License Renewal',
          code: 'LIC-REN',
          description: 'Renew driving license or vehicle registration',
          duration: 15,
          isActive: true,
        },
      }),
      prisma.serviceType.create({
        data: {
          branchId: branch.id,
          name: 'Document Processing',
          code: 'DOC-PROC',
          description: 'Process official documents and certificates',
          duration: 20,
          isActive: true,
        },
      }),
      prisma.serviceType.create({
        data: {
          branchId: branch.id,
          name: 'General Inquiry',
          code: 'GEN-INQ',
          description: 'General customer service and inquiries',
          duration: 10,
          isActive: true,
        },
      }),
    ]);
    allServiceTypes.push(...serviceTypes);
    console.log(`   ✓ ${branch.name}: ${serviceTypes.length} service types`);
  }
  
  // ============================================
  // Create Staff per Branch (1 Manager + 2 Staff)
  // ============================================
  console.log(`👥 Creating staff for each branch (1 manager + ${CONFIG.staffPerBranch} staff)...`);
  const allStaff: any[] = [];
  
  for (const branch of branches) {
    // Create Branch Manager
    const managerUser = await prisma.user.create({
      data: {
        email: `manager.${branch.code.toLowerCase()}@flowcare.com`,
        password: hashedPassword,
        firstName: 'Branch',
        lastName: `Manager ${branch.code}`,
        role: Role.BRANCH_MANAGER,
        phone: `+968 9${Math.floor(Math.random() * 9000000 + 1000000)}`,
      },
    });
    
    const manager = await prisma.staff.create({
      data: {
        userId: managerUser.id,
        branchId: branch.id,
        position: 'Branch Manager',
        employeeId: `EMP-${branch.code}-MGR`,
        isManager: true,
      },
    });
    allStaff.push(manager);
    console.log(`   ✓ Manager for ${branch.name}: ${managerUser.email}`);
    
    // Create Staff Members
    for (let i = 0; i < CONFIG.staffPerBranch; i++) {
      const staffUser = await prisma.user.create({
        data: {
          email: `staff${i + 1}.${branch.code.toLowerCase()}@flowcare.com`,
          password: hashedPassword,
          firstName: `Staff ${i + 1}`,
          lastName: `${branch.code}`,
          role: Role.STAFF,
          phone: `+968 9${Math.floor(Math.random() * 9000000 + 1000000)}`,
        },
      });
      
      const staff = await prisma.staff.create({
        data: {
          userId: staffUser.id,
          branchId: branch.id,
          position: 'Service Representative',
          employeeId: `EMP-${branch.code}-${String(i + 1).padStart(3, '0')}`,
          isManager: false,
        },
      });
      allStaff.push(staff);
      console.log(`   ✓ Staff ${i + 1} for ${branch.name}: ${staffUser.email}`);
    }
  }
  
  // ============================================
  // Create Customers
  // ============================================
  console.log('👤 Creating test customers...');
  const customers: Array<{ id: string; userId: string; email: string }> = [];
  
  for (let i = 0; i < 5; i++) {
    const customerUser = await prisma.user.create({
      data: {
        email: `customer${i + 1}@example.com`,
        password: hashedPassword,
        firstName: `Customer`,
        lastName: `${i + 1}`,
        role: Role.CUSTOMER,
        phone: `+968 9${Math.floor(Math.random() * 9000000 + 1000000)}`,
      },
    });
    
    const customer = await prisma.customer.create({
      data: {
        userId: customerUser.id,
        idNumber: `ID${new Date().getFullYear()}${String(i + 1).padStart(8, '0')}`,
        dateOfBirth: new Date(1990 + i, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28 + 1)),
      },
    });
    customers.push({
      id: customer.id,
      userId: customer.userId,
      email: customerUser.email,
    });
    console.log(`   ✓ Customer ${i + 1}: ${customerUser.email}`);
  }
  
  // ============================================
  // Create Time Slots for Next CONFIG.slotDays Days
  // ============================================
  console.log(`📅 Creating time slots for next ${CONFIG.slotDays} days...`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let totalSlots = 0;
  
  for (let day = 0; day < CONFIG.slotDays; day++) {
    const slotDate = new Date(today);
    slotDate.setDate(slotDate.getDate() + day + 1); // Start from tomorrow
    
    // Skip weekends (Friday and Saturday in Oman)
    const dayOfWeek = slotDate.getDay();
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      console.log(`   ⊘ Skipping weekend: ${slotDate.toDateString()}`);
      continue;
    }
    
    for (const branch of branches) {
      const branchServices = allServiceTypes.filter(st => st.branchId === branch.id);
      const branchStaff = allStaff.filter(s => s.branchId === branch.id);
      
      for (const serviceType of branchServices) {
        // Create 8 slots per day (9 AM to 4 PM, 1 hour each)
        for (let hour = 9; hour < 17; hour++) {
          const startTime = new Date(slotDate);
          startTime.setHours(hour, 0, 0, 0);
          
          const endTime = new Date(startTime);
          endTime.setHours(hour + 1, 0, 0, 0);
          
          const slot = await prisma.slot.create({
            data: {
              branchId: branch.id,
              serviceTypeId: serviceType.id,
              startTime,
              endTime,
              capacity: 1,
              bookedCount: 0,
              isActive: true,
            },
          });
          totalSlots++;
          
          // Assign staff to slot (rotate through available staff)
          const staffIndex = (hour - 9) % branchStaff.length;
          await prisma.slotAssignment.create({
            data: {
              slotId: slot.id,
              staffId: branchStaff[staffIndex].id,
            },
          });
        }
      }
    }
    
    console.log(`   ✓ ${slotDate.toDateString()}: slots created`);
  }
  
  console.log(`\n📊 Total slots created: ${totalSlots}`);
  
  // ============================================
  // Create a Few Sample Appointments
  // ============================================
  console.log('📝 Creating sample appointments...');
  
  if (customers.length > 0 && allStaff.length > 0) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(11, 0, 0, 0);
    
    // Get first slot for tomorrow at first branch
    const firstBranch = branches[0];
    const firstService = allServiceTypes.find(st => st.branchId === firstBranch.id);
    
    if (firstService) {
      const sampleSlot = await prisma.slot.create({
        data: {
          branchId: firstBranch.id,
          serviceTypeId: firstService.id,
          startTime: tomorrow,
          endTime: tomorrowEnd,
          capacity: 1,
          bookedCount: 1,
          isActive: true,
        },
      });
      
      const branchStaff = allStaff.filter(s => s.branchId === firstBranch.id);
      
      await prisma.appointment.create({
        data: {
          branchId: firstBranch.id,
          customerId: customers[0].id,
          slotId: sampleSlot.id,
          staffId: branchStaff[0]?.id,
          serviceTypeId: firstService.id,
          status: 'SCHEDULED',
          notes: 'Sample appointment for testing',
        },
      });
      console.log(`   ✓ Sample appointment created for customer ${customers[0].id}`);
    }
  }
  
  // ============================================
  // Create Audit Log Entry
  // ============================================
  await prisma.auditLog.create({
    data: {
      userId: adminUser.id,
      action: 'DATABASE_SEED',
      entity: 'System',
      metadata: {
        branches: branches.length,
        serviceTypes: allServiceTypes.length,
        staff: allStaff.length,
        customers: customers.length,
        slots: totalSlots,
      },
    },
  });
  
  console.log('\n✅ Database seeding completed successfully!');
  console.log('\n📋 Summary:');
  console.log(`   • Users: ${1 + 1 + branches.length * (1 + CONFIG.staffPerBranch) + customers.length} (1 admin, ${branches.length} managers, ${branches.length * CONFIG.staffPerBranch} staff, ${customers.length} customers)`);
  console.log(`   • Branches: ${branches.length}`);
  console.log(`   • Service Types: ${allServiceTypes.length}`);
  console.log(`   • Staff: ${allStaff.length}`);
  console.log(`   • Customers: ${customers.length}`);
  console.log(`   • Time Slots: ${totalSlots}`);
  console.log('\n🔐 Default password for all users: password123');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
