import { FluteProjectPreview } from "./flute/ProjectPreview";
import { VeloraProjectPreview } from "./velora/ProjectPreview";
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './style.css';
createRoot(document.getElementById('root')!).render(<FluteProjectPreview projectId="662706cb-2aeb-4ba4-b92f-4f8c8041d408" enabled={import.meta.env.DEV}>{<VeloraProjectPreview projectId="ebd92c02-5baa-4458-8a55-21a681c197b9" enabled={import.meta.env.DEV}>{<StrictMode><App/></StrictMode>}</VeloraProjectPreview>}</FluteProjectPreview>);
