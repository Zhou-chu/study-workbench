import {useWorkbenchSnapshot} from '../../app/WorkbenchSession';
import {LoginPage} from './LoginPage';
export function LoginRoute(){const {state,controller}=useWorkbenchSnapshot();return state&&controller?<LoginPage state={state} controller={controller}/>:null}
