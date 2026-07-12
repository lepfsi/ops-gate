# OpsGate DEMO — RouterOS (FACTICE)
# mikrotik routeros

/ip address add address=192.168.88.1/24 interface=bridge comment="demo-lan"
/ip firewall filter add chain=input action=accept protocol=tcp dst-port=8291
/ppp secret add name=vpn-demo password="MikroTikDemoPass1" service=any
/user add name=opsdemo password="RouterOS-Demo-2026" group=full
