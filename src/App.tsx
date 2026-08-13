import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/layout/AppShell';
import { RequirePermission, RequireInbox } from '@/components/RequirePermission';

import Dashboard from '@/pages/Dashboard';
import GlobalInbox from '@/pages/inbox/GlobalInbox';
import ItemMaster from '@/pages/master/ItemMaster';
import PartyMaster from '@/pages/master/PartyMaster';
import OfficeMaster from '@/pages/master/OfficeMaster';
import HsnMaster from '@/pages/master/HsnMaster';
import TermsMaster from '@/pages/master/TermsMaster';
import QuotesPending from '@/pages/quotations/QuotesPending';
import QuotesRevisions from '@/pages/quotations/QuotesRevisions';
import QuotationsList from '@/pages/quotations/QuotationsList';
import Verification from '@/pages/sales-orders/Verification';
import SalesOrdersList from '@/pages/sales-orders/SalesOrdersList';
import SalesOrderRevisions from '@/pages/sales-orders/SalesOrderRevisions';
import CreateSalesOrder from '@/pages/sales-orders/CreateSalesOrder';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/dashboard"
          element={
            <RequirePermission module="dashboard">
              <Dashboard />
            </RequirePermission>
          }
        />
        <Route
          path="/inbox"
          element={
            <RequireInbox>
              <GlobalInbox />
            </RequireInbox>
          }
        />

        {/* Masters */}
        <Route
          path="/master/items"
          element={
            <RequirePermission module="item_master">
              <ItemMaster />
            </RequirePermission>
          }
        />
        <Route
          path="/master/parties"
          element={
            <RequirePermission module="party_master">
              <PartyMaster />
            </RequirePermission>
          }
        />
        <Route
          path="/master/offices"
          element={
            <RequirePermission module="office_master">
              <OfficeMaster />
            </RequirePermission>
          }
        />
        <Route
          path="/master/hsn"
          element={
            <RequirePermission module="hsn_master">
              <HsnMaster />
            </RequirePermission>
          }
        />
        <Route
          path="/master/terms"
          element={
            <RequirePermission module="tc_master">
              <TermsMaster />
            </RequirePermission>
          }
        />

        {/* Quotations */}
        <Route
          path="/quotations/pending"
          element={
            <RequirePermission module="quotations">
              <QuotesPending />
            </RequirePermission>
          }
        />
        <Route
          path="/quotations/revisions"
          element={
            <RequirePermission module="quotations">
              <QuotesRevisions />
            </RequirePermission>
          }
        />
        <Route
          path="/quotations"
          element={
            <RequirePermission module="quotations">
              <QuotationsList />
            </RequirePermission>
          }
        />

        {/* Sales Orders */}
        <Route
          path="/sales-orders/verification"
          element={
            <RequirePermission module="sales_orders">
              <Verification />
            </RequirePermission>
          }
        />
        <Route
          path="/sales-orders"
          element={
            <RequirePermission module="sales_orders">
              <SalesOrdersList />
            </RequirePermission>
          }
        />
        <Route
          path="/sales-orders/revisions"
          element={
            <RequirePermission module="sales_orders">
              <SalesOrderRevisions />
            </RequirePermission>
          }
        />
        <Route
          path="/sales-orders/create"
          element={
            <RequirePermission module="sales_orders">
              <CreateSalesOrder />
            </RequirePermission>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
