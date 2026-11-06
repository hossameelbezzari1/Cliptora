import { AuthProvider } from './AuthProvider'
import { AppRouter } from './router'
import { ThemeProvider } from './ThemeProvider'

export default function App(){return <ThemeProvider><AuthProvider><AppRouter/></AuthProvider></ThemeProvider>}
