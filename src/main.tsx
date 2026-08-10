import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import '@/styles/theme.css'
import '@/styles/reader.css'
import { AppLayout } from '@/components/AppLayout'
import { ErrorScreen } from '@/components/ErrorScreen'
import Home from '@/routes/Home'
import Library from '@/routes/Library'
import Paper from '@/routes/Paper'
import Search from '@/routes/Search'
import Settings from '@/routes/Settings'

// import.meta.env.BASE_URL is "/ai-arxiv-reader/" in production and "/" in dev,
// so the same build works on Pages, a custom domain and localhost.
const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      errorElement: <ErrorScreen />,
      children: [
        { index: true, element: <Home /> },
        { path: 'search', element: <Search /> },
        { path: 'paper/:id/*', element: <Paper /> },
        { path: 'library', element: <Library /> },
        { path: 'settings', element: <Settings /> },
        { path: '*', element: <ErrorScreen notFound /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' }
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
