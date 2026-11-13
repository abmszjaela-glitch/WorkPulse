import { Link } from 'react-router-dom'
import useProfile from '../../hooks/useProfile.js'

export default function ProfileLink() {
  const { profile } = useProfile()
  return (
    <Link
      to="/profile"
      aria-label="Open my profile"
      title="My Profile"
      className="account-avatar overflow-hidden text-[10px] font-semibold"
    >
      {profile.photo ? (
        <img src={profile.photo} alt="" className="size-full object-cover" />
      ) : (
        `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase()
      )}
    </Link>
  )
}
