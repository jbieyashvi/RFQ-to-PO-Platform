import type { SalesOffice } from '@/types';

export const OFFICES: SalesOffice[] = [
  {
    id: 'off-mum',
    name: 'Mumbai',
    code: 'MUM-01',
    zone: 'West Zone',
    address: 'Unit 402, Lodha Supremus, Saki Vihar Road, Powai',
    city: 'Mumbai',
    state: 'Maharashtra',
    phone: '+91 22 4890 1200',
    email: 'mumbai@flowtech-instruments.com',
    active: true,
  },
  {
    id: 'off-del',
    name: 'Delhi NCR',
    code: 'DEL-02',
    zone: 'North Zone',
    address: 'Tower B, Spaze iTech Park, Sohna Road, Sector 49',
    city: 'Gurugram',
    state: 'Haryana',
    phone: '+91 124 462 3300',
    email: 'delhi@flowtech-instruments.com',
    active: true,
  },
  {
    id: 'off-blr',
    name: 'Bengaluru',
    code: 'BLR-03',
    zone: 'South Zone',
    address: '7th Floor, Prestige Tech Platina, Marathahalli ORR',
    city: 'Bengaluru',
    state: 'Karnataka',
    phone: '+91 80 4712 5500',
    email: 'bengaluru@flowtech-instruments.com',
    active: true,
  },
  {
    id: 'off-ahm',
    name: 'Ahmedabad',
    code: 'AHM-04',
    zone: 'West Zone',
    address: '3rd Floor, Titanium City Center, Anand Nagar Road',
    city: 'Ahmedabad',
    state: 'Gujarat',
    phone: '+91 79 4890 7700',
    email: 'ahmedabad@flowtech-instruments.com',
    active: true,
  },
  {
    id: 'off-che',
    name: 'Chennai',
    code: 'CHE-05',
    zone: 'South Zone',
    address: 'Module 12, Tidel Park, Taramani',
    city: 'Chennai',
    state: 'Tamil Nadu',
    phone: '+91 44 4210 6600',
    email: 'chennai@flowtech-instruments.com',
    active: false,
  },
];

export const officeName = (id: string) => OFFICES.find((o) => o.id === id)?.name ?? '—';
export const officeCode = (id: string) => OFFICES.find((o) => o.id === id)?.code ?? '—';
export const officeZone = (id: string) => OFFICES.find((o) => o.id === id)?.zone ?? '—';
