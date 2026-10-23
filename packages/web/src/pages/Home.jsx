import { GameLibrary } from '../components/GameLibrary.jsx';
import { DeviceConnection } from '../components/DeviceConnection.jsx';

export function Home() {
  return <main className="content pl-library"><DeviceConnection /><GameLibrary /></main>;
}
