import React from 'react'
import { createRoot } from 'react-dom/client'
import { addCollection } from '@iconify/react'
import pixelarticons from '@iconify-json/pixelarticons/icons.json'
import { App } from './App'
import { Sidebar } from './Sidebar'
import { SettingsApp } from './SettingsApp'
import './styles.css'

addCollection(pixelarticons as Parameters<typeof addCollection>[0])

const view = document.documentElement.dataset.cockpitView ?? 'main'
const Root = view === 'sidebar' ? Sidebar : view === 'settings' ? SettingsApp : App

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
