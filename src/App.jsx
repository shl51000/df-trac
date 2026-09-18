import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { FYProvider } from './context/FYContext'
import LoadingScreen from './components/LoadingScreen'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import Weavers from './pages/masters/Weavers'
import YarnTypes from './pages/masters/YarnTypes'
import FabricTypes from './pages/masters/FabricTypes'
import DesignLibrary from './pages/design-library/DesignLibrary'
import ProductionOrders from './pages/production-orders/ProductionOrders'
import YarnIssue from './pages/yarn-issue/YarnIssue'
import GoodsReceipt from './pages/goods-receipt/GoodsReceipt'
import PendingOrders from './pages/pending-orders/PendingOrders'
import YarnRequired from './pages/yarn-required/YarnRequired'
import OpeningBalance from './pages/opening-balance/OpeningBalance'
import StockInHand from './pages/stock-in-hand/StockInHand'
import ConsumptionNorms from './pages/consumption-norms/ConsumptionNorms'
import Users from './pages/users/Users'
import Reports from './pages/reports/Reports'

function Protected() {
  const { loading, session } = useAuth()
  if (loading) return <LoadingScreen />
  if (!session) return <Login />
  return (
    <FYProvider>
      <AppShell />
    </FYProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Protected />}>
            <Route index element={<Navigate to="/production-orders" replace />} />
            <Route path="weavers" element={<Weavers />} />
            <Route path="yarn-types" element={<YarnTypes />} />
            <Route path="fabric-types" element={<FabricTypes />} />
            <Route path="design-library" element={<DesignLibrary />} />
            <Route path="production-orders" element={<ProductionOrders />} />
            <Route path="yarn-required" element={<YarnRequired />} />
            <Route path="opening-balance" element={<OpeningBalance />} />
            <Route path="yarn-issued" element={<YarnIssue />} />
            <Route path="goods-receipt" element={<GoodsReceipt />} />
            <Route path="pending-orders" element={<PendingOrders />} />
            <Route path="stock" element={<StockInHand />} />
            <Route path="consumption-norms" element={<ConsumptionNorms />} />
            <Route path="users" element={<Users />} />
            <Route path="reports" element={<Reports />} />
            <Route path="*" element={<Navigate to="/weavers" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
