import { Navigate, Route, Routes } from 'react-router-dom'
import { Protected } from './AuthProvider'
import { LoginPage } from '../pages/auth/LoginPage'
import { RegisterPage } from '../pages/auth/RegisterPage'
import { ForgotPage } from '../pages/auth/ForgotPage'
import { ResetPage } from '../pages/auth/ResetPage'
import { DashboardPage } from '../pages/dashboard/DashboardPage'
import { EditorPage } from '../pages/editor/EditorPage'
import { ProfilePage } from '../pages/profile/ProfilePage'
import { AIStudioPage } from '../pages/ai-studio/AIStudioPage'
import { SettingsPage } from '../pages/settings/SettingsPage'
import { WorkflowPage } from '../pages/workflows/WorkflowPage'
export function AppRouter(){return <Routes>
 <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
 <Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<RegisterPage/>}/>
 <Route path="/forgot-password" element={<ForgotPage/>}/><Route path="/reset-password" element={<ResetPage/>}/>
 <Route path="/dashboard" element={<Protected><DashboardPage/></Protected>}/>
 <Route path="/projects/:id/editor" element={<Protected><EditorPage/></Protected>}/>
 <Route path="/projects/:id/workflows/:workflowId" element={<Protected><WorkflowPage/></Protected>}/>
 <Route path="/projects/:id/ai-studio" element={<Protected><AIStudioPage/></Protected>}/>
 <Route path="/profile" element={<Protected><ProfilePage/></Protected>}/>
 <Route path="/settings" element={<Protected><SettingsPage/></Protected>}/>
 <Route path="*" element={<Navigate to="/dashboard" replace/>}/>
 </Routes>}
