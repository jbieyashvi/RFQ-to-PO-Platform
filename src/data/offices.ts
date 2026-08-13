import type { SalesOffice } from '@/types';

export const OFFICES: SalesOffice[] = [
  {
    id: 'off-mum',
    name: 'Mumbai (West Zone)',
    code: 'MUM-01',
    address: 'Unit 402, Lodha Supremus, Saki Vihar Road, Powai',
    city: 'Mumbai',
    state: 'Maharashtra',
    active: true,
  },
  {
    id: 'off-del',
    name: 'Delhi NCR (North Zone)',
    code: 'DEL-02',
    address: 'Tower B, Spaze iTech Park, Sohna Road, Sector 49',
    city: 'Gurugram',
    state: 'Haryana',
    active: true,
  },
  {
    id: 'off-blr',
    name: 'Bengaluru (South Zone)',
    code: 'BLR-03',
    address: '7th Floor, Prestige Tech Platina, Marathahalli ORR',
    city: 'Bengaluru',
    state: 'Karnataka',
    active: true,
  },
  {
    id: 'off-ahm',
    name: 'Ahmedabad (West Zone)',
    code: 'AHM-04',
    address: '3rd Floor, Titanium City Center, Anand Nagar Road',
    city: 'Ahmedabad',
    state: 'Gujarat',
    active: true,
  },
  {
    id: 'off-che',
    name: 'Chennai (South Zone)',
    code: 'CHE-05',
    address: 'Module 12, Tidel Park, Taramani',
    city: 'Chennai',
    state: 'Tamil Nadu',
    active: false,
  },
];

export const officeName = (id: string) => OFFICES.find((o) => o.id === id)?.name ?? '—';
export const officeCode = (id: string) => OFFICES.find((o) => o.id === id)?.code ?? '—';
