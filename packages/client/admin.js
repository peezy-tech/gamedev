import 'ses'
import '@gamedev/core/lockdown.js'
import { createRoot } from 'react-dom/client'

import { AdminClient } from './admin-client.js'

const root = createRoot(document.getElementById('root'))
root.render(<AdminClient />)
